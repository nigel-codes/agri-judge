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
