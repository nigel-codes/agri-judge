"""
Judging API v6 - Production Ready
- County-based access control with strict validation
- Role-aware leaderboard (Judge = county-only, no lock; System Manager = full)
- female_led_bonus passed explicitly from frontend (manual judge decision)
- Enhanced security: SQL injection prevention, transaction management, audit trail
"""

import frappe
import json

NAMED_COUNTIES = ["Kakamega", "Homabay", "Kericho", "Meru"]


# ── Helpers ───────────────────────────────────────────────────

def _get_judge_county(judge_user):
    return frappe.db.get_value(
        "Judge County Assignment",
        {"judge": judge_user},
        "assigned_county",
    )


def _get_peer_evaluations(application_name, requesting_judge, county):
    """Return all submitted evaluations for an application by judges in the same county."""
    county_judges = frappe.get_all(
        "Judge County Assignment",
        filters={"assigned_county": county},
        fields=["judge"],
    )
    county_judge_ids = [j.judge for j in county_judges]
    if not county_judge_ids:
        return []

    evals = frappe.get_all(
        "Judge Evaluation",
        filters={
            "application": application_name,
            "judge": ["in", county_judge_ids],
            "docstatus": 1,
        },
        fields=["name", "judge", "final_score", "overall_notes", "female_led_bonus"],
    )

    result = []
    for ev in evals:
        eval_doc   = frappe.get_doc("Judge Evaluation", ev.name)
        judge_name = frappe.db.get_value("User", ev.judge, "full_name") or ev.judge
        result.append({
            "judge":            ev.judge,
            "judge_name":       judge_name,
            "is_own":           ev.judge == requesting_judge,
            "final_score":      round(float(ev.final_score or 0), 2),
            "female_led_bonus": bool(ev.female_led_bonus),
            "overall_notes":    ev.overall_notes or "",
            "criteria": [
                {
                    "criterion_id": c.criterion_id,
                    "score":        float(c.score or 0),
                    "notes":        c.notes or "",
                }
                for c in eval_doc.criteria
            ],
        })

    return result


def _get_applications_for_county(county):
    if county == "Other":
        all_apps = frappe.get_all(
            "Agri Waste Innovation",
            fields=["name", "full_name", "county_of_residence", "gender",
                    "level_of_project", "email"],
            order_by="creation desc",
        )
        return [a for a in all_apps
                if (a.county_of_residence or "").strip() not in NAMED_COUNTIES]
    return frappe.get_all(
        "Agri Waste Innovation",
        filters={"county_of_residence": county},
        fields=["name", "full_name", "county_of_residence", "gender",
                "level_of_project", "email"],
        order_by="creation desc",
    )


def _is_system_manager(user=None):
    """Check if user is a Coordinator (program manager role)"""
    return "Coordinator" in frappe.get_roles(user or frappe.session.user)


# ── Public API ────────────────────────────────────────────────

@frappe.whitelist()
def get_judge_county_info(judge=None):
    if not judge:
        judge = frappe.session.user
    county = _get_judge_county(judge)
    return {"success": True, "county": county, "has_assignment": county is not None}


@frappe.whitelist()
def get_judge_assignments(judge=None):
    try:
        if not judge:
            judge = frappe.session.user

        county = _get_judge_county(judge)
        if not county:
            return {
                "success": False,
                "error": (
                    "You have not been assigned to a county yet. "
                    "Please contact the coordinator to get your county assignment."
                ),
                "applications": [],
                "county": None,
            }

        applications = _get_applications_for_county(county)
        result = []

        for app in applications:
            eval_data = frappe.db.get_value(
                "Judge Evaluation",
                {"application": app.name, "judge": judge},
                ["docstatus", "final_score"],
                as_dict=True,
            )
            submitted   = bool(eval_data and eval_data.docstatus == 1)
            final_score = eval_data.final_score if eval_data else 0

            result.append({
                "name":           app.name,
                "applicant_name": app.full_name or app.name,
                "country":        app.county_of_residence or "",
                "gender":         app.gender or "",
                "category":       app.level_of_project or "",
                "submitted":      submitted,
                "final_score":    round(float(final_score), 2) if final_score else 0,
            })

        return {"success": True, "applications": result, "county": county}

    except Exception as e:
        frappe.log_error(f"get_judge_assignments error: {str(e)}", "Judging API")
        return {"success": False, "error": str(e), "applications": [], "county": None}


@frappe.whitelist()
def get_application_for_review(application_name, judge=None):
    try:
        if not judge:
            judge = frappe.session.user

        if not frappe.db.exists("Agri Waste Innovation", application_name):
            return {"success": False, "error": "Application not found"}

        county = _get_judge_county(judge)
        if not county:
            return {"success": False,
                    "error": "You have not been assigned to a county. Contact the coordinator."}

        app        = frappe.get_doc("Agri Waste Innovation", application_name)
        app_county = (app.county_of_residence or "").strip()

        if county == "Other":
            if app_county in NAMED_COUNTIES:
                return {"success": False,
                        "error": f"Access denied. This application is from {app_county}, "
                                  "which is outside your assigned county (Other)."}
        else:
            if app_county != county:
                return {"success": False,
                        "error": f"Access denied. This application is from "
                                  f"{app_county or 'an unknown county'}, "
                                  f"but you are assigned to {county}."}

        eval_name = frappe.db.get_value(
            "Judge Evaluation",
            {"application": application_name, "judge": judge},
            "name",
        )

        evaluation_data = None
        if eval_name:
            eval_doc = frappe.get_doc("Judge Evaluation", eval_name)
            if eval_doc.docstatus == 1:
                # Already submitted — return read-only view with all county peer evaluations
                own_eval = {
                    "name":             eval_doc.name,
                    "overall_notes":    eval_doc.overall_notes or "",
                    "female_led_bonus": bool(eval_doc.female_led_bonus),
                    "final_score":      round(float(eval_doc.final_score or 0), 2),
                    "criteria": [
                        {
                            "criterion_id": c.criterion_id,
                            "score":        float(c.score or 0),
                            "notes":        c.notes or "",
                        }
                        for c in eval_doc.criteria
                    ],
                }
                peer_evals = _get_peer_evaluations(application_name, judge, county)
                return {
                    "success":          True,
                    "read_only":        True,
                    "application": {
                        "name":                       app.name,
                        "full_name":                  app.full_name or "",
                        "gender":                     app.gender or "",
                        "county_of_residence":        app.county_of_residence or "",
                        "age_group":                  app.age_group or "",
                        "level_of_project":           app.level_of_project or "",
                        "email":                      app.email or "",
                        "phone_number":               app.phone_number or "",
                        "describe_your_idea":         app.describe_your_idea or "",
                        "proposed_product":           app.proposed_product or "",
                        "production_process":         app.production_process or "",
                        "enviromental_contributions": app.enviromental_contributions or "",
                        "demonstrate_innovativeness": app.demonstrate_innovativeness or "",
                        "enterprise_benefits":        app.enterprise_benefits or "",
                        "use_of_micro_grant":         app.use_of_micro_grant or "",
                        "prior_experience":           app.prior_experience or "",
                        "next_step_skills":           app.next_step_skills or "",
                        "incubator_programs":         app.incubator_programs or "",
                        "youtube_link":               app.youtube_link or "",
                    },
                    "evaluation":       own_eval,
                    "peer_evaluations": peer_evals,
                }
            evaluation_data = {
                "name":              eval_doc.name,
                "overall_notes":     eval_doc.overall_notes or "",
                "female_led_bonus":  bool(eval_doc.female_led_bonus),
                "criteria": [
                    {
                        "criterion_id": c.criterion_id,
                        "score":        float(c.score or 0),
                        "notes":        c.notes or "",
                    }
                    for c in eval_doc.criteria
                ],
            }

        return {
            "success": True,
            "application": {
                "name":                       app.name,
                "full_name":                  app.full_name or "",
                "gender":                     app.gender or "",
                "county_of_residence":        app.county_of_residence or "",
                "age_group":                  app.age_group or "",
                "level_of_project":           app.level_of_project or "",
                "email":                      app.email or "",
                "phone_number":               app.phone_number or "",
                "describe_your_idea":         app.describe_your_idea or "",
                "proposed_product":           app.proposed_product or "",
                "production_process":         app.production_process or "",
                "enviromental_contributions": app.enviromental_contributions or "",
                "demonstrate_innovativeness": app.demonstrate_innovativeness or "",
                "enterprise_benefits":        app.enterprise_benefits or "",
                "use_of_micro_grant":         app.use_of_micro_grant or "",
                "prior_experience":           app.prior_experience or "",
                "next_step_skills":           app.next_step_skills or "",
                "incubator_programs":         app.incubator_programs or "",
                "youtube_link":               app.youtube_link or "",
            },
            "evaluation": evaluation_data,
        }

    except Exception as e:
        frappe.log_error(f"get_application_for_review error: {str(e)}", "Judging API")
        return {"success": False, "error": str(e)}


@frappe.whitelist()
def submit_evaluation(application_name, criteria_scores,
                      overall_notes="", female_led_bonus=0, judge=None):
    """
    Submit a judge evaluation.

    female_led_bonus: 0 or 1 — explicitly set by the judge on the review form.
                      This is a conscious decision, not auto-derived from gender.
    """
    try:
        if not judge:
            judge = frappe.session.user

        if isinstance(criteria_scores, str):
            criteria_scores = json.loads(criteria_scores)

        # Normalise bonus to int
        female_led_bonus = int(female_led_bonus) if female_led_bonus else 0

        if not frappe.db.exists("Agri Waste Innovation", application_name):
            return {"success": False, "error": "Application not found"}

        # County access check
        county = _get_judge_county(judge)
        if not county:
            return {"success": False,
                    "error": "You have not been assigned to a county. Contact the coordinator."}

        app        = frappe.get_doc("Agri Waste Innovation", application_name)
        app_county = (app.county_of_residence or "").strip()

        if county == "Other":
            if app_county in NAMED_COUNTIES:
                return {"success": False,
                        "error": f"Access denied. Application county ({app_county}) "
                                  "is not in your assignment (Other)."}
        else:
            if app_county != county:
                return {"success": False,
                        "error": f"Access denied. Application is from {app_county}, "
                                  f"you are assigned to {county}."}

        # Duplicate check
        existing_status = frappe.db.get_value(
            "Judge Evaluation",
            {"application": application_name, "judge": judge},
            "docstatus",
        )
        if existing_status == 1:
            return {"success": False,
                    "error": "You have already submitted your evaluation for this application."}

        # Build and submit
        eval_doc = frappe.new_doc("Judge Evaluation")
        eval_doc.application     = application_name
        eval_doc.judge           = judge
        eval_doc.overall_notes   = overall_notes
        eval_doc.female_led_bonus = female_led_bonus   # ← judge's explicit choice

        for criterion_id, score_data in criteria_scores.items():
            eval_doc.append("criteria", {
                "criterion_id": criterion_id,
                "score":        float(score_data.get("score", 0)),
                "notes":        score_data.get("notes", ""),
            })

        eval_doc.insert(ignore_permissions=True)
        eval_doc.submit()
        frappe.db.commit()

        return {
            "success":              True,
            "message":              "Evaluation submitted successfully",
            "evaluation_name":      eval_doc.name,
            "final_score":          eval_doc.final_score,
            "total_weighted_score": eval_doc.total_weighted_score,
            "shortlisted":          bool(eval_doc.shortlisted),
        }

    except Exception as e:
        error_context = {
            "application": application_name,
            "judge": judge,
            "error_type": type(e).__name__,
            "error_message": str(e),
        }
        frappe.log_error(
            title="Submit Evaluation Failed",
            message=f"Error details: {json.dumps(error_context, indent=2)}\n\nFull traceback: {frappe.get_traceback()}",
        )
        frappe.db.rollback()
        return {"success": False, "error": f"Submission failed: {str(e)}. Please contact support if this persists."}


@frappe.whitelist()
def get_leaderboard():
    """
    Role-aware leaderboard.

    Coordinator  → all counties, full per-judge breakdown, variance warnings.
    Judge        → their county only, averaged scores only (no per-judge names/scores).
                   No lock - judges can view anytime to track progress.
    """
    try:
        caller     = frappe.session.user
        is_manager = _is_system_manager(caller)

        if is_manager:
            # ── Full leaderboard for coordinators ─────────────
            applications = frappe.get_all(
                "Agri Waste Innovation",
                fields=["name", "full_name", "county_of_residence",
                        "gender", "level_of_project"],
            )

            # How many judges exist total (for "X/Y judged" display)
            total_judges = frappe.db.count(
                "Judge County Assignment", {}
            ) or 1

            rows = []
            for app in applications:
                evals = frappe.get_all(
                    "Judge Evaluation",
                    filters={"application": app.name, "docstatus": 1},
                    fields=["final_score", "judge"],
                )
                scores = [float(e.final_score) for e in evals]
                if not scores:
                    continue

                avg    = sum(scores) / len(scores)
                spread = max(scores) - min(scores) if len(scores) > 1 else 0

                # Per-judge detail (coordinator only)
                judge_detail = []
                for e in evals:
                    uname = frappe.db.get_value("User", e.judge, "full_name") or e.judge
                    judge_detail.append({
                        "judge":       e.judge,
                        "judge_name":  uname,
                        "final_score": round(float(e.final_score), 2),
                    })

                rows.append({
                    "name":           app.name,
                    "applicant_name": app.full_name or app.name,
                    "county":         app.county_of_residence or "",
                    "gender":         app.gender or "",
                    "category":       app.level_of_project or "",
                    "avg_score":      round(avg, 2),
                    "total_score":    round(sum(scores), 2),
                    "judge_count":    len(scores),
                    "total_judges":   total_judges,
                    "variance":       round(spread, 2),
                    "high_variance":  spread > 3,
                    "status":         "complete" if len(scores) >= total_judges else "partial",
                    "judge_detail":   judge_detail,    # full breakdown
                    "is_manager_view": True,
                })

            rows.sort(key=lambda r: r["avg_score"], reverse=True)
            return {"success": True, "leaderboard": rows, "view": "coordinator"}

        else:
            # ── County-filtered leaderboard for judges ────────
            county = _get_judge_county(caller)
            if not county:
                return {"success": False,
                        "error": "You are not assigned to a county.",
                        "leaderboard": []}

            # Get all apps in judge's county
            my_apps   = _get_applications_for_county(county)
            my_app_names = [a.name for a in my_apps]

            # Calculate judge's completion status (for display, not gatekeeping)
            submitted_by_me = frappe.db.count(
                "Judge Evaluation",
                {"judge": caller, "docstatus": 1,
                 "application": ["in", my_app_names]},
            ) if my_app_names else 0
            
            my_pending_count = len(my_app_names) - submitted_by_me

            rows = []
            for app in my_apps:
                evals = frappe.get_all(
                    "Judge Evaluation",
                    filters={"application": app.name, "docstatus": 1},
                    fields=["final_score"],
                )
                scores = [float(e.final_score) for e in evals]
                if not scores:
                    continue

                avg = sum(scores) / len(scores)
                rows.append({
                    "name":           app.name,
                    "applicant_name": app.full_name or app.name,
                    "county":         app.county_of_residence or "",
                    "gender":         app.gender or "",
                    "category":       app.level_of_project or "",
                    "avg_score":      round(avg, 2),
                    "judge_count":    len(scores),
                    "status":         "partial" if len(scores) < 2 else "complete",
                    # No per-judge breakdown — judges only see the average
                    "judge_detail":   [],
                    "is_manager_view": False,
                })

            rows.sort(key=lambda r: r["avg_score"], reverse=True)
            return {
                "success":    True,
                "leaderboard": rows,
                "view":       "judge",
                "county":     county,
                "my_pending_count": my_pending_count,
                "my_completed_count": submitted_by_me,
            }

    except Exception as e:
        frappe.log_error(f"get_leaderboard error: {str(e)}", "Judging API")
        return {"success": False, "error": str(e), "leaderboard": []}


@frappe.whitelist()
def get_advanced_metrics():
    """
    Advanced judging metrics — Coordinator only.

    Returns:
    - Overall totals (apps, complete, incomplete, unevaluated, shortlisted, borderline, below)
    - Per-county breakdown with the same stats
    - Per incomplete application: which judge(s) are still pending
    """
    try:
        caller = frappe.session.user
        if not _is_system_manager(caller):
            return {"success": False, "error": "Access denied. Coordinator role required."}

        # ── Fetch base data ────────────────────────────────────
        all_apps = frappe.get_all(
            "Agri Waste Innovation",
            fields=["name", "full_name", "county_of_residence", "gender", "level_of_project"],
            order_by="county_of_residence, creation",
        )

        assignments = frappe.get_all(
            "Judge County Assignment",
            fields=["judge", "assigned_county"],
        )

        # county → list of judge user-ids
        county_judges = {}
        for a in assignments:
            county_judges.setdefault(a.assigned_county, []).append(a.judge)

        # pre-fetch judge full names
        judge_names = {}
        for a in assignments:
            if a.judge not in judge_names:
                judge_names[a.judge] = (
                    frappe.db.get_value("User", a.judge, "full_name") or a.judge
                )

        def effective_county(app_county):
            return (app_county or "").strip() if (app_county or "").strip() in NAMED_COUNTIES else "Other"

        # group apps by effective county
        apps_by_county = {}
        for app in all_apps:
            c = effective_county(app.county_of_residence)
            apps_by_county.setdefault(c, []).append(app)

        all_counties = sorted(
            set(list(apps_by_county.keys()) + list(county_judges.keys()))
        )

        grand = {"total_apps": len(all_apps), "complete": 0, "incomplete": 0,
                 "unevaluated": 0, "shortlisted": 0, "borderline": 0, "below": 0}

        county_metrics = []

        for county in all_counties:
            apps   = apps_by_county.get(county, [])
            judges = county_judges.get(county, [])

            if not apps:
                continue

            complete_apps    = []
            incomplete_apps  = []
            unevaluated_apps = []
            c_short = c_border = c_below = 0

            for app in apps:
                if judges:
                    evals = frappe.get_all(
                        "Judge Evaluation",
                        filters={"application": app.name, "judge": ["in", judges], "docstatus": 1},
                        fields=["judge", "final_score"],
                    )
                else:
                    evals = []

                submitted_set  = {e.judge for e in evals}
                pending_judges = [j for j in judges if j not in submitted_set]
                scores         = [float(e.final_score) for e in evals]
                avg_score      = round(sum(scores) / len(scores), 2) if scores else None

                app_info = {
                    "name":           app.name,
                    "applicant_name": app.full_name or app.name,
                    "gender":         app.gender or "",
                    "category":       app.level_of_project or "",
                    "avg_score":      avg_score,
                    "judges_done":    len(submitted_set),
                    "judges_total":   len(judges),
                    "pending_judges": [
                        {"judge": j, "judge_name": judge_names.get(j, j)}
                        for j in pending_judges
                    ],
                }

                if not scores:
                    unevaluated_apps.append(app_info)
                elif not pending_judges:
                    complete_apps.append(app_info)
                    if avg_score >= 7:   c_short  += 1
                    elif avg_score >= 5: c_border += 1
                    else:                c_below  += 1
                else:
                    incomplete_apps.append(app_info)
                    if avg_score >= 7:   c_short  += 1
                    elif avg_score >= 5: c_border += 1
                    else:                c_below  += 1

            grand["complete"]    += len(complete_apps)
            grand["incomplete"]  += len(incomplete_apps)
            grand["unevaluated"] += len(unevaluated_apps)
            grand["shortlisted"] += c_short
            grand["borderline"]  += c_border
            grand["below"]       += c_below

            county_metrics.append({
                "county":          county,
                "total_apps":      len(apps),
                "judges_count":    len(judges),
                "complete":        len(complete_apps),
                "incomplete":      len(incomplete_apps),
                "unevaluated":     len(unevaluated_apps),
                "shortlisted":     c_short,
                "borderline":      c_border,
                "below":           c_below,
                "complete_apps":   complete_apps,
                "incomplete_apps": incomplete_apps,
                "unevaluated_apps": unevaluated_apps,
            })

        # Include which apps are already in Round 2 so the UI can show correct button state
        round2_apps = {
            r.application
            for r in frappe.get_all("Round 2 Applicant", fields=["application"])
        }

        return {
            "success": True,
            "totals": grand,
            "counties": county_metrics,
            "round2_apps": list(round2_apps),
        }

    except Exception as e:
        frappe.log_error(f"get_advanced_metrics error: {str(e)}", "Judging API")
        return {"success": False, "error": str(e)}


@frappe.whitelist()
def add_to_round2(application_name, avg_score=None, score_status=None):
    """Add an application to the Round 2 shortlist. Coordinator only."""
    if not _is_system_manager(frappe.session.user):
        return {"success": False, "error": "Access denied."}
    if frappe.db.exists("Round 2 Applicant", {"application": application_name}):
        return {"success": False, "error": "Already in Round 2 list."}
    app = frappe.get_doc("Agri Waste Innovation", application_name)
    doc = frappe.new_doc("Round 2 Applicant")
    doc.application    = application_name
    doc.applicant_name = app.full_name or application_name
    doc.county         = app.county_of_residence or ""
    doc.avg_score      = float(avg_score) if avg_score is not None else 0.0
    doc.score_status   = score_status or ""
    doc.added_by       = frappe.session.user
    doc.added_on       = frappe.utils.now()
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"success": True, "name": doc.name}


@frappe.whitelist()
def remove_from_round2(application_name):
    """Remove an application from the Round 2 shortlist. Coordinator only."""
    if not _is_system_manager(frappe.session.user):
        return {"success": False, "error": "Access denied."}
    existing = frappe.db.get_value("Round 2 Applicant", {"application": application_name}, "name")
    if not existing:
        return {"success": False, "error": "Not in Round 2 list."}
    frappe.delete_doc("Round 2 Applicant", existing, ignore_permissions=True)
    frappe.db.commit()
    return {"success": True}


@frappe.whitelist()
def get_round2_list():
    """Return all Round 2 applicants with full details. Coordinator only."""
    if not _is_system_manager(frappe.session.user):
        return {"success": False, "error": "Access denied."}
    rows = frappe.get_all(
        "Round 2 Applicant",
        fields=["name", "application", "applicant_name", "county",
                "avg_score", "score_status", "added_by", "added_on"],
        order_by="county, avg_score desc",
    )
    # Enrich with gender/category from the application
    result = []
    for r in rows:
        extra = frappe.db.get_value(
            "Agri Waste Innovation", r.application,
            ["gender", "level_of_project"], as_dict=True
        ) or {}
        added_by_name = frappe.db.get_value("User", r.added_by, "full_name") or r.added_by
        result.append({
            "name":           r.name,
            "application":    r.application,
            "applicant_name": r.applicant_name,
            "county":         r.county,
            "avg_score":      round(float(r.avg_score or 0), 2),
            "score_status":   r.score_status,
            "gender":         extra.get("gender", ""),
            "category":       extra.get("level_of_project", ""),
            "added_by_name":  added_by_name,
            "added_on":       str(r.added_on or ""),
        })
    return {"success": True, "applicants": result}


@frappe.whitelist()
def get_round2_email_preview():
    """
    Returns a preview of who will receive each of the three Round 2 emails.
    Coordinator only.
    """
    if not _is_system_manager(frappe.session.user):
        return {"success": False, "error": "Access denied."}

    settings = frappe.get_single("Application Settings")
    form_link = settings.round2_form_link or ""

    # All Round 2 applicants — split by county type
    r2_rows = frappe.get_all(
        "Round 2 Applicant",
        fields=["application", "applicant_name", "county", "score_status",
                "avg_score", "invite_sent"],
        order_by="county, avg_score desc",
    )

    county_list = []
    other_list  = []
    for r in r2_rows:
        email = frappe.db.get_value("Agri Waste Innovation", r.application, "email") or ""
        entry = {
            "name":           r.applicant_name,
            "county":         r.county,
            "score_status":   r.score_status,
            "avg_score":      round(float(r.avg_score or 0), 2),
            "email":          email,
            "invite_sent":    bool(r.invite_sent),
        }
        if (r.county or "").strip() in NAMED_COUNTIES:
            county_list.append(entry)
        else:
            other_list.append(entry)

    # Regret: all applications NOT in Round 2
    r2_app_names = {
        r.application
        for r in frappe.get_all("Round 2 Applicant", fields=["application"])
    }
    all_apps = frappe.get_all(
        "Agri Waste Innovation",
        fields=["name", "full_name", "email", "county_of_residence"],
    )
    regret_list = [
        {
            "name":   a.full_name or a.name,
            "county": a.county_of_residence or "",
            "email":  a.email or "",
        }
        for a in all_apps
        if a.name not in r2_app_names
    ]

    return {
        "success":          True,
        "form_link":        form_link,
        "county_emails_sent": bool(settings.r2_county_emails_sent),
        "other_emails_sent":  bool(settings.r2_other_emails_sent),
        "regret_emails_sent": bool(settings.r2_regret_emails_sent),
        "county": county_list,
        "other":  other_list,
        "regret": regret_list,
    }


_EMAIL1_SUBJECT = "Congratulations! You're Shortlisted \u2013 Agri Waste Innovations Project (Level 2)"
_EMAIL1_BODY = """\
<p>Dear {applicant_name},</p>

<p>We are pleased to inform you that your innovative solution has successfully progressed
to the next stage of the <strong>Agri Waste Innovations Project</strong>, funded by
<strong>Airbus</strong> and implemented by <strong>KRCS \u2013 IOMe Social Innovation Centre</strong>.</p>

<p>Following a rigorous Phase 1 judging process, your application stood out, and we would
like to invite you to proceed to the final selection phase.</p>

<p><strong>Next Steps:</strong><br>
Before the final decisions are made, we require additional information from you.
Kindly complete the form via the link below.</p>

<p>\U0001f449 <a href="{form_link}">{form_link}</a></p>

<p>Please submit your responses by <strong>19/3/2026</strong>.
Failure to provide the requested information may affect your final consideration.</p>

<p>We look forward to learning more about your innovation.</p>

<p>Congratulations once again and thank you for your commitment to transforming agri-waste in Kenya.</p>

<p>Warm regards,<br>
<strong>The Agri Waste Innovations Team</strong><br>
Airbus Foundation \u00d7 KRCS-IOMe 254 Social Innovation Centre</p>
"""

_EMAIL2_SUBJECT = "Update \u2013 Your Shortlisted Status \u2013 Agri Waste Innovations Project"
_EMAIL2_BODY = """\
<p>Dear {applicant_name},</p>

<p>Thank you for your participation in the <strong>Agri Waste Innovations Project</strong>,
funded by <strong>Airbus</strong> and implemented by <strong>KRCS \u2013 IOMe 254 Social Innovation Centre</strong>.</p>

<p>We are pleased to inform you that your application met the minimum criteria and you have
been shortlisted for the next stage of the selection process.</p>

<p>However, we note that your innovation falls outside the primary counties initially
targeted for this phase. While we recognize the potential in your solution, participation
in the upcoming in-person bootcamps will require you to cover your own logistical costs
(transport and accommodation) to the hub closest to you.</p>

<p><strong>Available hubs:</strong></p>
<ul>
  <li>Kericho</li>
  <li>Homabay</li>
  <li>Kakamega</li>
  <li>Meru</li>
</ul>

<p><strong>Next Steps</strong><br>
To confirm your continued interest under these terms, kindly complete the form below
with the requested information:</p>

<p>\U0001f449 <a href="{form_link}">{form_link}</a></p>

<p><em>Please note: Final decisions will be made after reviewing your responses.
Submission of this form does not guarantee selection but confirms your interest
under the self-sponsored logistics arrangement.</em></p>

<p>Submit by <strong>19/3/2026</strong></p>

<p>We value your innovation and hope you will take advantage of this opportunity.</p>

<p>Warm regards,<br>
<strong>The Agri Waste Innovations Team</strong><br>
Airbus \u00d7 KRCS\u2013 IOMe 254 Social Innovation Centre</p>
"""

_EMAIL3_SUBJECT = "Update on Your Application \u2013 Agri Waste Innovations Project"
_EMAIL3_BODY = """\
<p>Dear {applicant_name},</p>

<p>Thank you for taking the time to apply for the <strong>Agri Waste Innovations Project</strong>,
funded by <strong>Airbus</strong> and implemented by <strong>KRCS IOMe 254 Social Innovation Centre</strong>.</p>

<p>We received an overwhelming number of high-quality applications, and the selection
process was highly competitive. After careful review by our judging panel, we regret to
inform you that your application did not achieve the minimum score required to progress
to the next phase.</p>

<p>This decision was not easy, and we encourage you not to be discouraged. We saw genuine
effort and creativity in your submission, and we hope you will continue developing your
innovation.</p>

<p>We invite you to follow our future programs and opportunities via <strong>IOMe 254</strong> platforms.</p>

<p>Thank you once again for your interest in transforming Kenya\u2019s agri-waste sector.</p>

<p>Warm regards,<br>
<strong>The Agri Waste Innovations Team</strong><br>
Airbus \u00d7 KRCS \u2013 IOMe 254</p>
"""


@frappe.whitelist()
def send_round2_county_emails():
    """
    Email 1: Invite shortlisted/borderline applicants from named counties (Kakamega,
    Homabay, Kericho, Meru). Coordinator only.
    """
    if not _is_system_manager(frappe.session.user):
        return {"success": False, "error": "Access denied."}

    settings  = frappe.get_single("Application Settings")
    form_link = settings.round2_form_link or "[Form link not set — please configure in Application Settings]"

    r2_rows = frappe.get_all(
        "Round 2 Applicant",
        filters={"invite_sent": 0},
        fields=["name", "application", "applicant_name", "county"],
    )
    targets = [r for r in r2_rows if (r.county or "").strip() in NAMED_COUNTIES]

    sent, skipped, errors = 0, 0, []
    for row in targets:
        try:
            email = frappe.db.get_value("Agri Waste Innovation", row.application, "email")
            full_name = frappe.db.get_value("Agri Waste Innovation", row.application, "full_name")
            if not email:
                errors.append(f"{row.applicant_name}: no email address on file")
                continue

            frappe.sendmail(
                recipients=[email],
                subject=_EMAIL1_SUBJECT,
                message=_EMAIL1_BODY.format(
                    applicant_name=full_name or row.applicant_name,
                    form_link=form_link,
                ),
                now=True,
            )

            frappe.db.set_value("Round 2 Applicant", row.name, {
                "invite_sent":    1,
                "invite_sent_on": frappe.utils.now(),
            }, update_modified=False)
            sent += 1

        except Exception as e:
            errors.append(f"{row.applicant_name}: {str(e)}")
            frappe.log_error(
                f"Round 2 county email error for {row.application}: {str(e)}",
                "Round 2 Emails"
            )

    settings.r2_county_emails_sent    = 1
    settings.r2_county_emails_sent_on = frappe.utils.now()
    settings.save(ignore_permissions=True)
    frappe.db.commit()

    result = {"success": True, "sent": sent, "total": len(targets), "errors": errors}
    if errors:
        result["warning"] = f"Sent {sent}/{len(targets)} emails. {len(errors)} failed."
    else:
        result["message"] = f"Sent {sent} email(s). {skipped} already sent previously — skipped."
    return result


@frappe.whitelist()
def send_round2_other_emails():
    """
    Email 2: Invite shortlisted/borderline applicants from counties outside the four
    named counties. Coordinator only.
    """
    if not _is_system_manager(frappe.session.user):
        return {"success": False, "error": "Access denied."}

    settings  = frappe.get_single("Application Settings")
    form_link = settings.round2_form_link or "[Form link not set — please configure in Application Settings]"

    r2_rows = frappe.get_all(
        "Round 2 Applicant",
        filters={"invite_sent": 0},
        fields=["name", "application", "applicant_name", "county"],
    )
    targets = [r for r in r2_rows if (r.county or "").strip() not in NAMED_COUNTIES]

    sent, errors = 0, []
    for row in targets:
        try:
            email     = frappe.db.get_value("Agri Waste Innovation", row.application, "email")
            full_name = frappe.db.get_value("Agri Waste Innovation", row.application, "full_name")
            if not email:
                errors.append(f"{row.applicant_name}: no email address on file")
                continue

            frappe.sendmail(
                recipients=[email],
                subject=_EMAIL2_SUBJECT,
                message=_EMAIL2_BODY.format(
                    applicant_name=full_name or row.applicant_name,
                    form_link=form_link,
                ),
                now=True,
            )

            frappe.db.set_value("Round 2 Applicant", row.name, {
                "invite_sent":    1,
                "invite_sent_on": frappe.utils.now(),
            }, update_modified=False)
            sent += 1

        except Exception as e:
            errors.append(f"{row.applicant_name}: {str(e)}")
            frappe.log_error(
                f"Round 2 other-county email error for {row.application}: {str(e)}",
                "Round 2 Emails"
            )

    settings.r2_other_emails_sent    = 1
    settings.r2_other_emails_sent_on = frappe.utils.now()
    settings.save(ignore_permissions=True)
    frappe.db.commit()

    result = {"success": True, "sent": sent, "total": len(targets), "errors": errors}
    if errors:
        result["warning"] = f"Sent {sent}/{len(targets)} emails. {len(errors)} failed."
    return result


@frappe.whitelist()
def send_round2_regret_emails(force=0):
    """
    Email 3: Send regret emails to all applicants NOT in the Round 2 shortlist.
    Coordinator only. Pass force=1 to override the already-sent guard.
    """
    if not _is_system_manager(frappe.session.user):
        return {"success": False, "error": "Access denied."}

    settings = frappe.get_single("Application Settings")
    if settings.r2_regret_emails_sent and not int(force):
        return {
            "success": False,
            "already_sent": True,
            "sent_on": str(settings.r2_regret_emails_sent_on or ""),
            "error": "Regret emails have already been sent. Use force send to resend."
        }

    r2_app_names = {
        r.application
        for r in frappe.get_all("Round 2 Applicant", fields=["application"])
    }

    all_apps = frappe.get_all(
        "Agri Waste Innovation",
        fields=["name", "full_name", "email", "county_of_residence"],
    )
    targets = [a for a in all_apps if a.name not in r2_app_names]

    if not targets:
        return {"success": False, "error": "All applicants are already in the Round 2 list."}

    sent, errors = 0, []
    for app in targets:
        try:
            if not app.email:
                errors.append(f"{app.full_name}: no email address on file")
                continue

            frappe.sendmail(
                recipients=[app.email],
                subject=_EMAIL3_SUBJECT,
                message=_EMAIL3_BODY.format(
                    applicant_name=app.full_name or app.name,
                ),
                now=True,
            )
            sent += 1

        except Exception as e:
            errors.append(f"{app.full_name}: {str(e)}")
            frappe.log_error(
                f"Round 2 regret email error for {app.name}: {str(e)}",
                "Round 2 Emails"
            )

    settings = frappe.get_single("Application Settings")
    settings.r2_regret_emails_sent    = 1
    settings.r2_regret_emails_sent_on = frappe.utils.now()
    settings.save(ignore_permissions=True)
    frappe.db.commit()

    result = {"success": True, "sent": sent, "total": len(targets), "errors": errors}
    if errors:
        result["warning"] = f"Sent {sent}/{len(targets)} regret emails. {len(errors)} failed."
    return result


@frappe.whitelist()
def get_criteria_definitions():
    return {
        "success": True,
        "criteria": [
            {"id": "technical",      "name": "Technical Capabilities",      "weight": 0.25, "max_score": 10},
            {"id": "innovativeness", "name": "Innovativeness",              "weight": 0.25, "max_score": 10},
            {"id": "scalability",    "name": "Scalability & Viability",     "weight": 0.20, "max_score": 10},
            {"id": "impact",         "name": "Impact & Sustainability",     "weight": 0.20, "max_score": 10},
            {"id": "presentation",   "name": "Completeness & Presentation", "weight": 0.10, "max_score": 1},
        ],
    }


# ── Round 2 Judging ───────────────────────────────────────────

@frappe.whitelist()
def get_round2_response_for_review(response_name):
    """Return full Round 2 Response detail + attachments + current score. Coordinator only."""
    if not _is_system_manager(frappe.session.user):
        return {"success": False, "error": "Access denied. Coordinator role required."}
    try:
        if not frappe.db.exists("Round 2 Response", response_name):
            return {"success": False, "error": "Round 2 Response not found."}

        doc = frappe.get_doc("Round 2 Response", response_name)

        scored_by_name = (
            frappe.db.get_value("User", doc.scored_by, "full_name") or doc.scored_by
            if doc.scored_by else None
        )

        # Attachments: the financial_records field + any files attached to this doc
        attachments = []
        if doc.financial_records:
            attachments.append({
                "file_url":  doc.financial_records,
                "file_name": doc.financial_records.split("/")[-1],
                "label":     "Financial Records",
            })
        extra_files = frappe.get_all(
            "File",
            filters={"attached_to_doctype": "Round 2 Response", "attached_to_name": response_name},
            fields=["file_url", "file_name", "file_size"],
        )
        for f in extra_files:
            if f.file_url != doc.financial_records:
                attachments.append({"file_url": f.file_url, "file_name": f.file_name, "label": None})

        return {
            "success": True,
            "response": {
                "name":                 doc.name,
                "applicant_name":       doc.applicant_name or "",
                "county":               doc.county or "",
                "county_other":         doc.county_other or "",
                "gender":               doc.gender or "",
                "age":                  doc.age or "",
                "developmental_level":  doc.developmental_level or "",
                "is_tech_enabled":      bool(doc.is_tech_enabled),
                "innovation_description": doc.innovation_description or "",
                "resources_needed":     doc.resources_needed or "",
                "score":                round(float(doc.score), 1) if doc.score else 0,
                "score_notes":          doc.score_notes or "",
                "scored_by":            doc.scored_by or "",
                "scored_by_name":       scored_by_name or "",
                "scored_on":            str(doc.scored_on) if doc.scored_on else "",
            },
            "attachments": attachments,
        }
    except Exception as e:
        frappe.log_error(f"get_round2_response_for_review error: {str(e)}", "Judging API")
        return {"success": False, "error": str(e)}


@frappe.whitelist()
def get_round2_responses_for_judging():
    """Return all Round 2 Responses with existing scores. Coordinator only."""
    if not _is_system_manager(frappe.session.user):
        return {"success": False, "error": "Access denied. Coordinator role required."}
    try:
        rows = frappe.get_all(
            "Round 2 Response",
            fields=[
                "name", "applicant_name", "county", "gender", "age",
                "developmental_level", "is_tech_enabled",
                "innovation_description", "resources_needed",
                "score", "score_notes", "scored_by", "scored_on",
            ],
            order_by="county, applicant_name",
        )
        result = []
        for r in rows:
            scored_by_name = (
                frappe.db.get_value("User", r.scored_by, "full_name") or r.scored_by
                if r.scored_by else None
            )
            result.append({
                "name":                 r.name,
                "applicant_name":       r.applicant_name or "",
                "county":               r.county or "",
                "gender":               r.gender or "",
                "age":                  r.age or "",
                "developmental_level":  r.developmental_level or "",
                "is_tech_enabled":      bool(r.is_tech_enabled),
                "innovation_description": r.innovation_description or "",
                "resources_needed":     r.resources_needed or "",
                "score":                round(float(r.score), 1) if r.score else 0,
                "score_notes":          r.score_notes or "",
                "scored_by":            r.scored_by or "",
                "scored_by_name":       scored_by_name or "",
                "scored_on":            str(r.scored_on) if r.scored_on else "",
            })
        return {"success": True, "responses": result}
    except Exception as e:
        frappe.log_error(f"get_round2_responses_for_judging error: {str(e)}", "Judging API")
        return {"success": False, "error": str(e)}


@frappe.whitelist()
def save_round2_score(response_name, score, notes=""):
    """Save (or overwrite) the coordinator's score on a Round 2 Response. Coordinator only."""
    if not _is_system_manager(frappe.session.user):
        return {"success": False, "error": "Access denied. Coordinator role required."}
    try:
        score = float(score)
        if score < 0 or score > 10:
            return {"success": False, "error": "Score must be between 0 and 10."}

        if not frappe.db.exists("Round 2 Response", response_name):
            return {"success": False, "error": "Round 2 Response not found."}

        doc = frappe.get_doc("Round 2 Response", response_name)
        doc.score      = score
        doc.score_notes = notes or ""
        doc.scored_by  = frappe.session.user
        doc.scored_on  = frappe.utils.now()
        doc.save(ignore_permissions=True)
        frappe.db.commit()

        scored_by_name = frappe.db.get_value("User", doc.scored_by, "full_name") or doc.scored_by
        return {
            "success":        True,
            "scored_by":      doc.scored_by,
            "scored_by_name": scored_by_name,
            "scored_on":      str(doc.scored_on),
        }
    except Exception as e:
        frappe.log_error(f"save_round2_score error: {str(e)}", "Judging API")
        frappe.db.rollback()
        return {"success": False, "error": str(e)}
