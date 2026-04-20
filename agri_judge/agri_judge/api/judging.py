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
    """Return list of counties assigned to the judge (empty list if none)."""
    rows = frappe.get_all(
        "Judge County Assignment",
        filters={"judge": judge_user},
        fields=["assigned_county"],
    )
    return [r.assigned_county for r in rows]


def _get_judge_assignment(judge_user):
    """Return (counties_list, judging_round) for a judge, or ([], None) if not assigned.

    judging_round is a combined value across all assignments:
      - "Both"    if judge has access to R1 and R2 (any mix)
      - "Round 1" if only R1 access
      - "Round 2" if only R2 access
    """
    rows = frappe.get_all(
        "Judge County Assignment",
        filters={"judge": judge_user},
        fields=["assigned_county", "judging_round"],
    )
    if not rows:
        return [], None

    counties = [r.assigned_county for r in rows]
    rounds = {(r.judging_round or "Round 1") for r in rows}

    has_r1 = bool(rounds & {"Round 1", "Both"})
    has_r2 = bool(rounds & {"Round 2", "Both"})
    if has_r1 and has_r2:
        combined_round = "Both"
    elif has_r2:
        combined_round = "Round 2"
    else:
        combined_round = "Round 1"

    return counties, combined_round


def _judge_can_access_county(judge_counties, app_county):
    """Return True if app_county falls within any of the judge's assigned counties."""
    app_county = (app_county or "").strip()
    for jc in judge_counties:
        if jc == "Other":
            if app_county not in NAMED_COUNTIES:
                return True
        else:
            if app_county == jc:
                return True
    return False


def _has_r1_access(judging_round):
    return judging_round in ("Round 1", "Both")


def _has_r2_access(judging_round):
    return judging_round in ("Round 2", "Both")


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


def _get_applications_for_county(counties):
    """Return applications accessible to a judge assigned to the given counties (list or str)."""
    if isinstance(counties, str):
        counties = [counties]

    all_apps = frappe.get_all(
        "Agri Waste Innovation",
        fields=["name", "full_name", "county_of_residence", "gender",
                "level_of_project", "email"],
        order_by="creation desc",
    )

    # Build set of explicitly named counties the judge covers
    named_in_assignment = {c for c in counties if c != "Other"}
    covers_other = "Other" in counties

    result = []
    seen = set()
    for app in all_apps:
        app_county = (app.county_of_residence or "").strip()
        include = False
        if app_county in named_in_assignment:
            include = True
        elif covers_other and app_county not in NAMED_COUNTIES:
            include = True
        if include and app.name not in seen:
            seen.add(app.name)
            result.append(app)
    return result


def _is_system_manager(user=None):
    """Check if user is a Coordinator (program manager role)"""
    return "Coordinator" in frappe.get_roles(user or frappe.session.user)


# ── Public API ────────────────────────────────────────────────

@frappe.whitelist()
def get_judge_county_info(judge=None):
    if not judge:
        judge = frappe.session.user
    counties = _get_judge_county(judge)
    return {"success": True, "county": counties[0] if counties else None,
            "counties": counties, "has_assignment": bool(counties)}


@frappe.whitelist()
def get_judge_assignments(judge=None):
    try:
        if not judge:
            judge = frappe.session.user

        counties, judging_round = _get_judge_assignment(judge)
        if not counties:
            return {
                "success": False,
                "error": (
                    "You have not been assigned to a county yet. "
                    "Please contact the coordinator to get your county assignment."
                ),
                "applications": [],
                "county": None,
                "code": "NO_ASSIGNMENT",
            }

        if not _has_r1_access(judging_round):
            return {
                "success": False,
                "error": "You are assigned to Round 2 only. Round 1 applications are not accessible.",
                "applications": [],
                "county": ", ".join(counties),
                "code": "WRONG_ROUND",
            }

        applications = _get_applications_for_county(counties)
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

        return {"success": True, "applications": result, "county": ", ".join(counties)}

    except Exception as e:
        frappe.log_error(f"get_judge_assignments error: {str(e)}", "Judging API")
        return {"success": False, "error": str(e), "applications": [], "county": None}


@frappe.whitelist()
def get_r1_applications_view(judge=None):
    """
    Return all Round 1 applications for the judge's county with average scores.
    Accessible to both R1 and R2 judges (read-only for R2).
    """
    try:
        if not judge:
            judge = frappe.session.user

        counties, judging_round = _get_judge_assignment(judge)
        if not counties:
            return {
                "success": False,
                "error": "You have not been assigned to a county. Contact the coordinator.",
                "applications": [],
            }

        applications = _get_applications_for_county(counties)
        result = []
        for app in applications:
            evals = frappe.get_all(
                "Judge Evaluation",
                filters={"application": app.name, "docstatus": 1},
                fields=["final_score"],
            )
            eval_count = len(evals)
            avg_score  = round(
                sum(float(e.final_score or 0) for e in evals) / eval_count, 2
            ) if eval_count else 0

            result.append({
                "name":           app.name,
                "applicant_name": app.full_name or app.name,
                "county":         app.county_of_residence or "",
                "gender":         app.gender or "",
                "category":       app.level_of_project or "",
                "eval_count":     eval_count,
                "avg_score":      avg_score,
            })

        return {
            "success":      True,
            "applications": result,
            "county":       ", ".join(counties),
        }
    except Exception as e:
        frappe.log_error(f"get_r1_applications_view error: {str(e)}", "Judging API")
        return {"success": False, "error": str(e), "applications": []}


@frappe.whitelist()
def get_r1_application_read_only(application_name, judge=None):
    """
    Return application details + all submitted judge evaluations (read-only).
    Accessible to both R1 and R2 judges. No scoring is possible through this endpoint.
    """
    try:
        if not judge:
            judge = frappe.session.user

        if not frappe.db.exists("Agri Waste Innovation", application_name):
            return {"success": False, "error": "Application not found."}

        counties, judging_round = _get_judge_assignment(judge)
        if not counties:
            return {"success": False, "error": "No county assignment found."}

        app        = frappe.get_doc("Agri Waste Innovation", application_name)
        app_county = (app.county_of_residence or "").strip()

        if not _judge_can_access_county(counties, app_county):
            return {"success": False,
                    "error": f"Access denied. This application is from {app_county}."}

        evals = frappe.get_all(
            "Judge Evaluation",
            filters={"application": application_name, "docstatus": 1},
            fields=["name", "final_score", "female_led_bonus"],
        )

        evaluations = []
        for ev in evals:
            eval_doc = frappe.get_doc("Judge Evaluation", ev.name)
            evaluations.append({
                "final_score":      round(float(ev.final_score or 0), 2),
                "female_led_bonus": bool(ev.female_led_bonus),
                "criteria": [
                    {"criterion_id": c.criterion_id, "score": float(c.score or 0)}
                    for c in eval_doc.criteria
                ],
            })

        avg_score = round(
            sum(e["final_score"] for e in evaluations) / len(evaluations), 2
        ) if evaluations else 0

        return {
            "success": True,
            "application": {
                "name":                       app.name,
                "full_name":                  app.full_name or "",
                "gender":                     app.gender or "",
                "county_of_residence":        app.county_of_residence or "",
                "age_group":                  app.age_group or "",
                "level_of_project":           app.level_of_project or "",
                "prior_experience":           app.prior_experience or "",
                "proposed_product":           app.proposed_product or "",
                "describe_your_idea":         app.describe_your_idea or "",
                "production_process":         app.production_process or "",
                "enviromental_contributions": app.enviromental_contributions or "",
                "demonstrate_innovativeness": app.demonstrate_innovativeness or "",
                "enterprise_benefits":        app.enterprise_benefits or "",
                "use_of_micro_grant":         app.use_of_micro_grant or "",
                "next_step_skills":           app.next_step_skills or "",
                "youtube_link":               app.youtube_link or "",
            },
            "evaluations": evaluations,
            "avg_score":   avg_score,
            "eval_count":  len(evaluations),
        }
    except Exception as e:
        frappe.log_error(f"get_r1_application_read_only error: {str(e)}", "Judging API")
        return {"success": False, "error": str(e)}


@frappe.whitelist()
def get_application_for_review(application_name, judge=None):
    try:
        if not judge:
            judge = frappe.session.user

        if not frappe.db.exists("Agri Waste Innovation", application_name):
            return {"success": False, "error": "Application not found"}

        counties, judging_round = _get_judge_assignment(judge)
        if not counties:
            return {"success": False,
                    "error": "You have not been assigned to a county. Contact the coordinator."}
        if not _has_r1_access(judging_round):
            return {"success": False,
                    "error": "You are not authorized for Round 1 judging."}

        app        = frappe.get_doc("Agri Waste Innovation", application_name)
        app_county = (app.county_of_residence or "").strip()

        if not _judge_can_access_county(counties, app_county):
            return {"success": False,
                    "error": f"Access denied. This application is from "
                              f"{app_county or 'an unknown county'}, "
                              f"which is outside your assigned counties ({', '.join(counties)})."}

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
                peer_evals = _get_peer_evaluations(application_name, judge, app_county)
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

        # County + round access check
        counties, judging_round = _get_judge_assignment(judge)
        if not counties:
            return {"success": False,
                    "error": "You have not been assigned to a county. Contact the coordinator."}
        if not _has_r1_access(judging_round):
            return {"success": False,
                    "error": "You are not authorized for Round 1 judging."}

        app        = frappe.get_doc("Agri Waste Innovation", application_name)
        app_county = (app.county_of_residence or "").strip()

        if not _judge_can_access_county(counties, app_county):
            return {"success": False,
                    "error": f"Access denied. Application is from {app_county}, "
                              f"you are assigned to {', '.join(counties)}."}

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
            counties = _get_judge_county(caller)
            if not counties:
                return {"success": False,
                        "error": "You are not assigned to a county.",
                        "leaderboard": []}

            # Get all apps in judge's counties
            my_apps   = _get_applications_for_county(counties)
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

        # Look up the linked Round 1 application via the Round 2 Applicant record
        round1_application = None
        r2_applicant = frappe.db.get_value(
            "Round 2 Applicant",
            {"applicant_name": doc.applicant_name},
            ["application"],
            as_dict=True,
        )
        if r2_applicant and r2_applicant.get("application"):
            app_name = r2_applicant["application"]
            if frappe.db.exists("Agri Waste Innovation", app_name):
                app = frappe.get_doc("Agri Waste Innovation", app_name)
                round1_application = {
                    "name":                      app.name,
                    "full_name":                 app.full_name or "",
                    "email":                     app.email or "",
                    "gender":                    app.gender or "",
                    "county_of_residence":       app.county_of_residence or "",
                    "age_group":                 app.age_group or "",
                    "phone_number":              app.phone_number or "",
                    "prior_experience":          app.prior_experience or "",
                    "proposed_product":          app.proposed_product or "",
                    "describe_your_idea":        app.describe_your_idea or "",
                    "level_of_project":          app.level_of_project or "",
                    "production_process":        app.production_process or "",
                    "enviromental_contributions":app.enviromental_contributions or "",
                    "monthly_revenue":           app.monthly_revenue or "",
                    "demonstrate_innovativeness":app.demonstrate_innovativeness or "",
                    "use_of_micro_grant":        app.use_of_micro_grant or "",
                    "enterprise_benefits":       app.enterprise_benefits or "",
                    "youtube_link":              app.youtube_link or "",
                    "next_step_skills":          app.next_step_skills or "",
                    "incubator_programs":        app.incubator_programs or "",
                    "supporting_documents":      app.supporting_documents or "",
                }

        # Judge evaluations for this response
        judge_evals = frappe.get_all(
            "Round 2 Judge Evaluation",
            filters={"r2_applicant": response_name, "docstatus": 1},
            fields=["judge", "subtotal_score", "tech_bonus_points", "leverage_points", "total_score", "passes_cutoff"],
        )
        judge_scores = []
        for e in judge_evals:
            jname = frappe.db.get_value("User", e.judge, "full_name") or e.judge
            judge_scores.append({
                "judge_name":    jname,
                "subtotal":      round(float(e.subtotal_score or 0), 1),
                "tech_bonus":    round(float(e.tech_bonus_points or 0), 1),
                "leverage":      round(float(e.leverage_points or 0), 1),
                "total":         round(float(e.total_score or 0), 1),
                "passes_cutoff": bool(e.passes_cutoff),
            })
        avg_score = None
        if judge_scores:
            avg_score = round(sum(j["total"] for j in judge_scores) / len(judge_scores), 1)

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
            "round1_application": round1_application,
            "judge_scores": judge_scores,
            "avg_score": avg_score,
        }
    except Exception as e:
        frappe.log_error(f"get_round2_response_for_review error: {str(e)}", "Judging API")
        return {"success": False, "error": str(e)}


@frappe.whitelist()
def get_r2_applicants_with_email():
    """Return all Round 2 Applicants with their R1 email. Coordinator only."""
    if not _is_system_manager(frappe.session.user):
        return {"success": False, "error": "Access denied."}
    try:
        rows = frappe.get_all(
            "Round 2 Applicant",
            fields=["name", "applicant_name", "county", "application"],
            order_by="county, applicant_name",
        )
        result = []
        for r in rows:
            email = ""
            if r.application and frappe.db.exists("Agri Waste Innovation", r.application):
                email = frappe.db.get_value("Agri Waste Innovation", r.application, "email") or ""
            result.append({
                "name":           r.name,
                "applicant_name": r.applicant_name or "",
                "county":         r.county or "",
                "r1_application": r.application or "",
                "email":          email,
            })
        return {"success": True, "applicants": result}
    except Exception as e:
        frappe.log_error(f"get_r2_applicants_with_email error: {str(e)}", "Judging API")
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


# ══════════════════════════════════════════════════════════════════════
# Round 2 Multi-Judge Scoring (new rubric — 7 criteria, 110 pts max)
# ══════════════════════════════════════════════════════════════════════

from agri_judge.agri_judge.doctype.round_2_judge_evaluation.round_2_judge_evaluation import (
    CRITERIA_META as R2_CRITERIA_META,
    TECH_BONUS_MAP,
    LEVERAGE_POINTS,
    CUTOFF,
    MIN_SCORE_FOR_LEVERAGE,
)


@frappe.whitelist()
def get_r2_criteria_definitions():
    """Return rubric criteria metadata for the judging UI."""
    criteria = [
        {
            "id": "c1", "name": "Novelty & Innovation", "max_points": 25, "multiplier": 5,
            "desc": "Projects beyond common ideas (BSF, simple briquettes, generic fertiliser). Priority to county-specific value chains: coffee, tea, banana, sugarcane, rice, fish, livestock.",
            "guiding": "Has the applicant identified a waste stream or transformation method that is rarely used in their county?",
            "bands": [
                {"score": 0, "text": "No innovation — copy of existing common solution."},
                {"score": 1, "text": "Minor variation of a common idea (e.g., another BSF project from food waste)."},
                {"score": 2, "text": "Some novelty but still resembles many existing projects."},
                {"score": 3, "text": "Clearly novel within the county context; not commonly seen."},
                {"score": 4, "text": "Highly novel product or process; potential for intellectual property."},
                {"score": 5, "text": "Breakthrough innovation — could create a new market or sub-sector."},
            ],
        },
        {
            "id": "c2", "name": "Alignment with Agri Waste Focus", "max_points": 15, "multiplier": 3,
            "desc": "Use of agricultural farm waste (not household/market food waste). Preferred: coffee pulp, tea fluff, banana pseudostem, sugarcane bagasse, rice husks, fish offal, livestock manure.",
            "guiding": "Does the project directly address a waste problem from coffee, tea, banana, sugarcane, rice, fish, or livestock in the applicant's county?",
            "bands": [
                {"score": 0, "text": "Waste type is entirely non-agricultural (plastic, general solid waste)."},
                {"score": 1, "text": "Mostly food waste from markets/homes, with weak agri link."},
                {"score": 2, "text": "Mix of food and agri waste, but agri component is minor."},
                {"score": 3, "text": "Clear use of agricultural waste from at least one cash crop."},
                {"score": 4, "text": "Uses multiple agri waste streams from the county's main value chains."},
                {"score": 5, "text": "Innovative valorisation of a neglected agri waste stream (e.g., coffee cherry husks, rice straw)."},
            ],
        },
        {
            "id": "c3", "name": "Developmental Level & Traction", "max_points": 20, "multiplier": 4,
            "desc": "Projects beyond idea stage. Preference for validation, early traction, or revenue. Applicants >5 months operations must submit financial records.",
            "guiding": "Can the applicant demonstrate that someone has already paid for or used their solution?",
            "bands": [
                {"score": 0, "text": "Idea only — no prototype, no testing, no evidence."},
                {"score": 1, "text": "Idea with some customer interviews but no prototype."},
                {"score": 2, "text": "MVP developed, early user tests done, no revenue."},
                {"score": 3, "text": "MVP tested with at least 10 users; some positive feedback; no or minimal revenue."},
                {"score": 4, "text": "Initial revenue (KES 10,000–100,000) or 20+ paying customers/users."},
                {"score": 5, "text": "Revenue >KES 100,000, or 50+ paying customers, or proven repeat purchases, or grant/prize received."},
            ],
            "note": "For applicants >5 months without financial records, max score is 2 unless a valid written explanation is provided.",
        },
        {
            "id": "c4", "name": "Market Potential & Scalability", "max_points": 15, "multiplier": 3,
            "desc": "Clear customer segment, willingness to pay, and potential to grow beyond village or county. Export potential or replication across counties is a plus.",
            "guiding": "Could this business realistically grow to serve multiple counties or export markets within 3 years?",
            "bands": [
                {"score": 0, "text": "No identified customer or market."},
                {"score": 1, "text": "Vague market (\"all farmers\") — no segmentation."},
                {"score": 2, "text": "Identified a specific customer type but no evidence of demand."},
                {"score": 3, "text": "Customer type identified and initial interest shown (e.g., 5 potential buyers)."},
                {"score": 4, "text": "Clear path to at least 100 customers or regional expansion within 2 years."},
                {"score": 5, "text": "Demonstrated export potential or partnership with a large off-taker (hotel chain, supermarket, factory)."},
            ],
        },
        {
            "id": "c5", "name": "Resource & Skill Needs", "max_points": 10, "multiplier": 2,
            "desc": "Honest, specific, and realistic listing of what the applicant needs to launch or scale. Vague answers score low; detailed answers with cost estimates score high.",
            "guiding": "If the judge had to connect this applicant with a mentor or investor, would the list be useful?",
            "bands": [
                {"score": 0, "text": "No list, or irrelevant items."},
                {"score": 1, "text": "Very vague (\"we need funding and equipment\")."},
                {"score": 2, "text": "Some specific items but missing key details."},
                {"score": 3, "text": "Clear list of 3–5 specific resources with approximate costs or sources."},
                {"score": 4, "text": "Detailed list with priorities, cost estimates, and potential local providers."},
                {"score": 5, "text": "Exceptional detail: timeline, cost breakdown, identified partners, and skills gap plan."},
            ],
        },
        {
            "id": "c6", "name": "Quality of Description", "max_points": 15, "multiplier": 3,
            "desc": "Clarity, authenticity, and personal voice (not excessive AI use). Max 350 words.",
            "guiding": "Does this sound like a real person who is deeply involved in the problem?",
            "bands": [
                {"score": 0, "text": "Incoherent, heavily AI-generated without substance, or missing."},
                {"score": 1, "text": "Mostly AI-sounding, little personal insight; hard to follow."},
                {"score": 2, "text": "Some AI use but applicant's voice partially visible."},
                {"score": 3, "text": "Clear, authentic, written by the applicant; explains the innovation well."},
                {"score": 4, "text": "Excellent clarity, compelling story, demonstrates passion and knowledge."},
                {"score": 5, "text": "Outstanding — judge feels inspired and fully understands the innovation."},
            ],
        },
    ]
    tech = {
        "id": "c7", "name": "Tech Enablement (Bonus)", "max_points": 5,
        "desc": "Use of digital tools, mobile apps, sensors, data platforms, or simple automation. Bonus — not required, but rewarded.",
        "guiding": "Does the project use technology to improve efficiency, traceability, or customer reach?",
        "bands": [
            {"score": 0, "text": "No tech component."},
            {"score": 1, "text": "Tech mentioned but not integrated (e.g., \"we will use WhatsApp\"). → 2 pts"},
            {"score": 2, "text": "Basic tech (e.g., simple app, SMS, digital records). → 3 pts"},
            {"score": 3, "text": "Advanced tech (IoT, platform, machine learning, blockchain). → 5 pts"},
        ],
    }
    leverage_info = {
        "description": "Extra credit for high Round 1 performers. Applied only when Level 2 subtotal ≥ 40.",
        "table": [
            {"category": "Top Shortlisted",  "points": 10},
            {"category": "Above Threshold",  "points": 5},
            {"category": "At Threshold",     "points": 2},
            {"category": "Female Applicant", "points": 5},
        ],
        "cutoff": CUTOFF,
    }
    return {
        "success":     True,
        "criteria":    criteria,
        "tech":        tech,
        "leverage":    leverage_info,
        "total_max":   110,
        "cutoff":      CUTOFF,
    }


def _get_r1_leverage_info(applicant_name):
    """
    Given an applicant_name from Round 2 Response, find their Round 1
    performance and return (r1_avg_score, leverage_category).

    Priority:
      1. Coordinator-set leverage_category on Round 2 Applicant record.
      2. Auto-determined from Round 1 Judge Evaluation average score.
      3. Defaults to (None, "None") if no Round 1 data found.
    """
    if not applicant_name:
        return None, "None"

    # Find matching Round 1 application by full name
    apps = frappe.get_all(
        "Agri Waste Innovation",
        filters={"full_name": applicant_name},
        fields=["name"],
        limit=1,
    )
    if not apps:
        return None, "None"

    app_name = apps[0].name

    # 1. Check for a coordinator-set leverage_category on Round 2 Applicant
    r2_applicant = frappe.db.get_value(
        "Round 2 Applicant",
        {"application": app_name},
        ["leverage_category", "avg_score"],
        as_dict=True,
    )
    if r2_applicant and r2_applicant.leverage_category and r2_applicant.leverage_category != "None":
        r1_avg = round(float(r2_applicant.avg_score or 0), 2) or None
        return r1_avg, r2_applicant.leverage_category

    # 2. Compute from Round 1 Judge Evaluation scores
    evals = frappe.get_all(
        "Judge Evaluation",
        filters={"application": app_name, "docstatus": 1},
        fields=["final_score"],
    )
    if not evals:
        return None, "None"

    scores  = [float(e.final_score or 0) for e in evals]
    r1_avg  = round(sum(scores) / len(scores), 2)

    if r1_avg >= 8.0:
        leverage_category = "Top Shortlisted"
    elif r1_avg >= 7.0:
        leverage_category = "Above Threshold"
    elif r1_avg >= 5.0:
        leverage_category = "At Threshold"
    else:
        leverage_category = "None"

    return r1_avg, leverage_category


def _r2_responded_names():
    """Return a set of applicant_name values that have submitted a Round 2 Response."""
    responses = frappe.get_all("Round 2 Response", fields=["applicant_name"])
    return {r.applicant_name for r in responses if r.applicant_name}


def _get_r2_responses_for_county(counties):
    """Return Round 2 Response records for the given counties (list or str)."""
    if isinstance(counties, str):
        counties = [counties]

    all_resp = frappe.get_all(
        "Round 2 Response",
        fields=["name", "applicant_name", "county", "gender"],
    )

    named_in_assignment = {c for c in counties if c != "Other"}
    covers_other = "Other" in counties

    result = []
    seen = set()
    for r in all_resp:
        resp_county = (r.county or "").strip()
        include = False
        if resp_county in named_in_assignment:
            include = True
        elif covers_other and resp_county not in NAMED_COUNTIES:
            include = True
        if include and r.name not in seen:
            seen.add(r.name)
            result.append(r)
    return result


def _build_r2_response_row(resp, judge):
    """Build a judge assignment row from a Round 2 Response record."""
    eval_data = frappe.db.get_value(
        "Round 2 Judge Evaluation",
        {"r2_applicant": resp.name, "judge": judge},
        ["docstatus", "total_score"],
        as_dict=True,
    )
    submitted   = bool(eval_data and eval_data.docstatus == 1)
    total_score = eval_data.total_score if eval_data else 0
    return {
        "r2_applicant":      resp.name,
        "application":       "",
        "applicant_name":    resp.applicant_name or "",
        "county":            resp.county or "",
        "gender":            resp.gender or "",
        "score_status":      "",
        "leverage_category": "None",
        "submitted":         submitted,
        "total_score":       round(float(total_score), 2) if total_score else 0,
    }


def _get_r2_peer_evaluations(r2_applicant, requesting_judge, county):
    """Return all submitted R2 evaluations for an applicant visible to the requesting judge.
    Includes county-peer judges + any coordinator evaluations."""
    # Collect eligible judge IDs: county-assigned R2 judges + coordinators who submitted
    county_judges = frappe.get_all(
        "Judge County Assignment",
        filters={"assigned_county": county, "judging_round": ["in", ["Round 2", "Both"]]},
        fields=["judge"],
    )
    county_judge_ids = set(j.judge for j in county_judges)

    # All submitted evals for this applicant (to also capture coordinator submissions)
    all_evals = frappe.get_all(
        "Round 2 Judge Evaluation",
        filters={"r2_applicant": r2_applicant, "docstatus": 1},
        fields=["name", "judge"],
    )
    # Include if judge is a county peer OR if the submitter is a coordinator
    eligible_judge_ids = set()
    for ev in all_evals:
        if ev.judge in county_judge_ids or _is_system_manager(ev.judge):
            eligible_judge_ids.add(ev.judge)

    if not eligible_judge_ids:
        return []

    evals = frappe.get_all(
        "Round 2 Judge Evaluation",
        filters={
            "r2_applicant": r2_applicant,
            "judge": ["in", list(eligible_judge_ids)],
            "docstatus": 1,
        },
        fields=["name", "judge", "subtotal_score", "tech_bonus_points",
                "leverage_points", "total_score", "passes_cutoff", "overall_notes"],
    )
    result = []
    for ev in evals:
        eval_doc   = frappe.get_doc("Round 2 Judge Evaluation", ev.name)
        judge_name = frappe.db.get_value("User", ev.judge, "full_name") or ev.judge
        result.append({
            "judge":           ev.judge,
            "judge_name":      judge_name,
            "is_own":          ev.judge == requesting_judge,
            "subtotal_score":  round(float(ev.subtotal_score or 0), 2),
            "tech_bonus":      round(float(ev.tech_bonus_points or 0), 2),
            "leverage_points": round(float(ev.leverage_points or 0), 2),
            "total_score":     round(float(ev.total_score or 0), 2),
            "passes_cutoff":   bool(ev.passes_cutoff),
            "overall_notes":   ev.overall_notes or "",
            "criteria": [
                {
                    "criterion_id": c.criterion_id,
                    "score":        int(c.score or 0),
                    "points_earned": float(c.points_earned or 0),
                    "notes":        c.notes or "",
                }
                for c in eval_doc.criteria
            ],
        })
    return result



@frappe.whitelist()
def get_r2_judge_assignments(judge=None):
    """Return Round 2 Applicants with scoring status.
    Coordinators see ALL applicants across all counties.
    Judges see only their assigned county (and only if Round 2 authorized).
    """
    try:
        if not judge:
            judge = frappe.session.user

        # Coordinators see all Round 2 Responses
        if _is_system_manager(judge):
            r2_list = frappe.get_all(
                "Round 2 Response",
                fields=["name", "applicant_name", "county", "gender"],
            )
            result = [_build_r2_response_row(r, judge) for r in r2_list]
            completed = sum(1 for r in result if r["submitted"])
            return {
                "success":       True,
                "applicants":    result,
                "county":        "All",
                "is_coordinator": True,
                "completed":     completed,
                "total":         len(result),
            }

        counties, judging_round = _get_judge_assignment(judge)
        if not counties:
            return {
                "success": False,
                "error": "You have not been assigned to a county. Contact the coordinator.",
                "applicants": [], "county": None,
                "code": "NO_ASSIGNMENT",
            }

        if not _has_r2_access(judging_round):
            return {
                "success": False,
                "error": "You are assigned to Round 1 only. Round 2 applications are not accessible.",
                "applicants": [],
                "county": ", ".join(counties),
                "code": "WRONG_ROUND",
            }

        r2_list  = _get_r2_responses_for_county(counties)
        result   = [_build_r2_response_row(r, judge) for r in r2_list]
        completed = sum(1 for r in result if r["submitted"])
        return {
            "success":    True,
            "applicants": result,
            "county":     ", ".join(counties),
            "completed":  completed,
            "total":      len(result),
        }
    except Exception as e:
        frappe.log_error(f"get_r2_judge_assignments error: {str(e)}", "Judging API")
        return {"success": False, "error": str(e), "applicants": [], "county": None}


@frappe.whitelist()
def get_application_for_r2_review(r2_applicant_name, judge=None):
    """
    Return full data for a Round 2 response review.
    r2_applicant_name is a Round 2 Response name.
    """
    try:
        if not judge:
            judge = frappe.session.user

        if not frappe.db.exists("Round 2 Response", r2_applicant_name):
            return {"success": False, "error": "Round 2 Response not found."}

        resp = frappe.get_doc("Round 2 Response", r2_applicant_name)
        is_coordinator = _is_system_manager(judge)
        county = resp.county or "All"

        if not is_coordinator:
            judge_counties, judging_round = _get_judge_assignment(judge)
            if not judge_counties:
                return {"success": False,
                        "error": "You have not been assigned to a county. Contact the coordinator."}
            if not _has_r2_access(judging_round):
                return {"success": False,
                        "error": "You are not authorized for Round 2 judging. Contact the coordinator."}

            resp_county = (resp.county or "").strip()
            if not _judge_can_access_county(judge_counties, resp_county):
                return {"success": False,
                        "error": f"Access denied. Applicant is from {resp_county}, "
                                  f"you are assigned to {', '.join(judge_counties)}."}

        # Existing evaluation by this judge
        eval_name = frappe.db.get_value(
            "Round 2 Judge Evaluation",
            {"r2_applicant": r2_applicant_name, "judge": judge},
            "name",
        )
        evaluation_data = None
        read_only       = False
        peer_evals      = []

        if eval_name:
            eval_doc  = frappe.get_doc("Round 2 Judge Evaluation", eval_name)
            read_only = eval_doc.docstatus == 1
            own_eval  = {
                "name":            eval_doc.name,
                "subtotal_score":  eval_doc.subtotal_score,
                "tech_score":      eval_doc.tech_score,
                "tech_bonus_points": eval_doc.tech_bonus_points,
                "leverage_category": eval_doc.leverage_category,
                "female_applicant":  bool(eval_doc.female_applicant),
                "leverage_points":   eval_doc.leverage_points,
                "total_score":       eval_doc.total_score,
                "passes_cutoff":     bool(eval_doc.passes_cutoff),
                "overall_notes":     eval_doc.overall_notes or "",
                "criteria": [
                    {
                        "criterion_id":  c.criterion_id,
                        "score":         int(c.score or 0),
                        "points_earned": float(c.points_earned or 0),
                        "notes":         c.notes or "",
                    }
                    for c in eval_doc.criteria
                ],
            }
            evaluation_data = own_eval
            if read_only:
                peer_evals = _get_r2_peer_evaluations(r2_applicant_name, judge, county)

        r2_response = {
            "name":                  resp.name,
            "gender":                resp.gender or "",
            "county":                resp.county or "",
            "age":                   resp.age or "",
            "developmental_level":   resp.developmental_level or "",
            "is_tech_enabled":       bool(resp.is_tech_enabled),
            "innovation_description": resp.innovation_description or "",
            "resources_needed":      resp.resources_needed or "",
            "financial_records":     resp.financial_records or "",
        }

        # Look up linked Round 1 application via the Round 2 Applicant record
        _r2_applicant_rec = frappe.db.get_value(
            "Round 2 Applicant",
            {"applicant_name": resp.applicant_name},
            ["application"],
            as_dict=True,
        )
        r1_application_name = _r2_applicant_rec.get("application") if _r2_applicant_rec else None

        return {
            "success":      True,
            "read_only":    read_only,
            "r2_applicant": {
                "name":              resp.name,
                "applicant_name":    resp.applicant_name or "",
                "county":            resp.county or "",
                "avg_score":         0,
                "score_status":      "",
                "leverage_category": "None",
            },
            "application": {
                "name":               resp.name,
                "full_name":          resp.applicant_name or "",
                "gender":             resp.gender or "",
                "county_of_residence": resp.county or "",
                "age_group":          str(resp.age) if resp.age else "",
                "level_of_project":   resp.developmental_level or "",
            },
            "r2_response":          r2_response,
            "evaluation":           evaluation_data,
            "peer_evaluations":     peer_evals,
            "r1_application_name":  r1_application_name,
        }
    except Exception as e:
        frappe.log_error(f"get_application_for_r2_review error: {str(e)}", "Judging API")
        return {"success": False, "error": str(e)}


@frappe.whitelist()
def submit_r2_evaluation(r2_applicant_name, criteria_scores,
                         tech_score=0, overall_notes="",
                         leverage_category="None", female_applicant=None, judge=None):
    """Submit a Round 2 judge evaluation. r2_applicant_name is a Round 2 Response name."""
    try:
        if not judge:
            judge = frappe.session.user

        if isinstance(criteria_scores, str):
            criteria_scores = json.loads(criteria_scores)

        if not frappe.db.exists("Round 2 Response", r2_applicant_name):
            return {"success": False, "error": "Round 2 Response not found."}

        # Coordinators bypass county/round restrictions
        if not _is_system_manager(judge):
            counties, judging_round = _get_judge_assignment(judge)
            if not counties:
                return {"success": False,
                        "error": "You have not been assigned to a county. Contact the coordinator."}
            if not _has_r2_access(judging_round):
                return {"success": False,
                        "error": "You are not authorized for Round 2 judging."}

            r2_county = frappe.db.get_value(
                "Round 2 Response", r2_applicant_name, "county"
            ) or ""
            if not _judge_can_access_county(counties, r2_county.strip()):
                return {"success": False,
                        "error": f"Access denied. Applicant is from {r2_county}, "
                                  f"you are assigned to {', '.join(counties)}."}

        # Duplicate check
        existing_status = frappe.db.get_value(
            "Round 2 Judge Evaluation",
            {"r2_applicant": r2_applicant_name, "judge": judge},
            "docstatus",
        )
        if existing_status == 1:
            return {"success": False,
                    "error": "You have already submitted your evaluation for this applicant."}

        eval_doc = frappe.new_doc("Round 2 Judge Evaluation")
        eval_doc.r2_applicant      = r2_applicant_name
        eval_doc.judge             = judge
        eval_doc.tech_score        = str(int(tech_score or 0))
        eval_doc.overall_notes     = overall_notes
        eval_doc.leverage_category = leverage_category or "None"
        if female_applicant is not None:
            eval_doc.female_applicant = int(female_applicant)

        for criterion_id, score_data in criteria_scores.items():
            eval_doc.append("criteria", {
                "criterion_id": criterion_id,
                "score":        int(score_data.get("score", 0)),
                "notes":        score_data.get("notes", ""),
            })

        eval_doc.insert(ignore_permissions=True)
        eval_doc.submit()
        frappe.db.commit()

        return {
            "success":         True,
            "message":         "Round 2 evaluation submitted successfully.",
            "evaluation_name": eval_doc.name,
            "subtotal_score":  eval_doc.subtotal_score,
            "tech_bonus":      eval_doc.tech_bonus_points,
            "leverage_points": eval_doc.leverage_points,
            "total_score":     eval_doc.total_score,
            "passes_cutoff":   bool(eval_doc.passes_cutoff),
        }
    except Exception as e:
        frappe.log_error(f"submit_r2_evaluation error: {str(e)}", "Judging API")
        frappe.db.rollback()
        return {"success": False, "error": str(e)}


@frappe.whitelist()
def get_r2_leaderboard():
    """
    Round 2 leaderboard with averaged judge scores + leverage points.
    Coordinator: all counties, full breakdown.
    Judge: own county, averaged totals only.
    """
    try:
        caller     = frappe.session.user
        is_manager = _is_system_manager(caller)

        if is_manager:
            r2_list = frappe.get_all(
                "Round 2 Response",
                fields=["name", "applicant_name", "county"],
            )
            rows = []
            for r in r2_list:
                evals = frappe.get_all(
                    "Round 2 Judge Evaluation",
                    filters={"r2_applicant": r.name, "docstatus": 1},
                    fields=["judge", "subtotal_score", "tech_bonus_points",
                            "leverage_points", "total_score", "passes_cutoff"],
                )
                if not evals:
                    continue

                scores   = [float(e.total_score or 0) for e in evals]
                avg_tot  = sum(scores) / len(scores)
                spread   = max(scores) - min(scores) if len(scores) > 1 else 0

                judge_detail = []
                for e in evals:
                    jname = frappe.db.get_value("User", e.judge, "full_name") or e.judge
                    judge_detail.append({
                        "judge":           e.judge,
                        "judge_name":      jname,
                        "subtotal_score":  round(float(e.subtotal_score or 0), 2),
                        "tech_bonus":      round(float(e.tech_bonus_points or 0), 2),
                        "leverage_points": round(float(e.leverage_points or 0), 2),
                        "total_score":     round(float(e.total_score or 0), 2),
                        "passes_cutoff":   bool(e.passes_cutoff),
                    })

                rows.append({
                    "r2_applicant":    r.name,
                    "application":     "",
                    "applicant_name":  r.applicant_name or "",
                    "county":          r.county or "",
                    "r1_avg_score":    0,
                    "score_status":    "",
                    "leverage_category": "None",
                    "avg_total_score": round(avg_tot, 2),
                    "judge_count":     len(scores),
                    "variance":        round(spread, 2),
                    "high_variance":   spread > 20,
                    "has_r2_response": True,
                    "passes_cutoff":   avg_tot >= CUTOFF,
                    "judge_detail":    judge_detail,
                    "is_manager_view": True,
                })

            rows.sort(key=lambda r: r["avg_total_score"], reverse=True)
            return {"success": True, "leaderboard": rows, "view": "coordinator",
                    "cutoff": CUTOFF}

        else:
            counties = _get_judge_county(caller)
            if not counties:
                return {"success": False,
                        "error": "You are not assigned to a county.",
                        "leaderboard": []}

            my_r2 = _get_r2_responses_for_county(counties)
            rows  = []
            for r in my_r2:
                evals = frappe.get_all(
                    "Round 2 Judge Evaluation",
                    filters={"r2_applicant": r.name, "docstatus": 1},
                    fields=["total_score", "passes_cutoff"],
                )
                if not evals:
                    continue
                scores  = [float(e.total_score or 0) for e in evals]
                avg_tot = sum(scores) / len(scores)
                rows.append({
                    "r2_applicant":    r.name,
                    "applicant_name":  r.applicant_name or "",
                    "county":          r.county or "",
                    "avg_total_score": round(avg_tot, 2),
                    "judge_count":     len(scores),
                    "passes_cutoff":   avg_tot >= CUTOFF,
                    "is_manager_view": False,
                })

            rows.sort(key=lambda r: r["avg_total_score"], reverse=True)
            return {"success": True, "leaderboard": rows, "view": "judge",
                    "county": ", ".join(counties), "cutoff": CUTOFF}

    except Exception as e:
        frappe.log_error(f"get_r2_leaderboard error: {str(e)}", "Judging API")
        return {"success": False, "error": str(e), "leaderboard": []}


@frappe.whitelist()
def get_r2_scoring_progress():
    """Coordinator: summary of how many R2 responses have been scored and by how many judges."""
    if not _is_system_manager(frappe.session.user):
        return {"success": False, "error": "Access denied."}
    try:
        r2_list = frappe.get_all(
            "Round 2 Response",
            fields=["name", "applicant_name", "county"],
        )
        county_judges = {}
        for a in frappe.get_all(
            "Judge County Assignment",
            filters={"judging_round": ["in", ["Round 2", "Both"]]},
            fields=["judge", "assigned_county"],
        ):
            county_judges.setdefault(a.assigned_county, []).append(a.judge)

        result = []
        for r in r2_list:
            evals = frappe.get_all(
                "Round 2 Judge Evaluation",
                filters={"r2_applicant": r.name, "docstatus": 1},
                fields=["judge", "subtotal_score", "tech_bonus_points",
                        "leverage_points", "total_score", "passes_cutoff"],
            )
            eff_county   = r.county if r.county in NAMED_COUNTIES else "Other"
            expected_cnt = len(county_judges.get(eff_county, []))
            scores       = [float(e.total_score or 0) for e in evals]
            avg_tot      = round(sum(scores) / len(scores), 2) if scores else None

            judge_scores = []
            for e in evals:
                judge_name = frappe.db.get_value("User", e.judge, "full_name") or e.judge
                judge_scores.append({
                    "judge_name":      judge_name,
                    "subtotal":        round(float(e.subtotal_score or 0), 1),
                    "tech_bonus":      round(float(e.tech_bonus_points or 0), 1),
                    "leverage":        round(float(e.leverage_points or 0), 1),
                    "total":           round(float(e.total_score or 0), 1),
                    "passes_cutoff":   bool(e.passes_cutoff),
                })

            result.append({
                "r2_applicant":    r.name,
                "applicant_name":  r.applicant_name or "",
                "county":          r.county or "",
                "judges_completed": len(evals),
                "judges_expected":  expected_cnt,
                "complete":         len(evals) >= expected_cnt > 0,
                "avg_total_score":  avg_tot,
                "passes_cutoff":    (avg_tot or 0) >= CUTOFF,
                "judge_scores":     judge_scores,
            })

        total_complete = sum(1 for r in result if r["complete"])
        return {
            "success":    True,
            "total":      len(result),
            "complete":   total_complete,
            "incomplete": len(result) - total_complete,
            "applicants": result,
        }
    except Exception as e:
        frappe.log_error(f"get_r2_scoring_progress error: {str(e)}", "Judging API")
        return {"success": False, "error": str(e)}


# ── Round 2 Finalists ─────────────────────────────────────────

_FINALIST_SUBJECT = "Congratulations! You\u2019re a Finalist \u2013 Agri Waste Innovations Project"
_FINALIST_BODY = """\
<p>Dear {applicant_name},</p>

<p>We are thrilled to inform you that you have been selected as a <strong>Finalist</strong>
in the <strong>Agri Waste Innovations Project</strong>, funded by <strong>Airbus</strong>
and implemented by <strong>KRCS \u2013 IOMe 254 Social Innovation Centre</strong>.</p>

<p>Following a thorough evaluation of your Round 2 submission by our expert judging panel,
your innovation has been identified as one of the top solutions in this challenge.</p>

<p>Further details regarding the next steps, including dates, venues, and any requirements,
will be communicated to you shortly. Please ensure your contact information is up to date.</p>

<p>Congratulations on this outstanding achievement, and thank you for your dedication to
transforming Kenya\u2019s agri-waste sector.</p>

<p>Warm regards,<br>
<strong>The Agri Waste Innovations Team</strong><br>
Airbus Foundation \u00d7 KRCS-IOMe 254 Social Innovation Centre</p>
"""

_FINALIST_REGRET_SUBJECT = "Update on Your Round 2 Application \u2013 Agri Waste Innovations Project"
_FINALIST_REGRET_BODY = """\
<p>Dear {applicant_name},</p>

<p>Thank you for your participation in Round 2 of the <strong>Agri Waste Innovations Project</strong>,
funded by <strong>Airbus</strong> and implemented by
<strong>KRCS \u2013 IOMe 254 Social Innovation Centre</strong>.</p>

<p>We received many high-quality submissions in Round 2, and the selection process was
highly competitive. After careful review by our judging panel, we regret to inform you
that your application was not selected to proceed to the finalist stage.</p>

<p>We commend you for your innovation and effort, and we encourage you to continue
developing your solution. We hope to see your work grow and evolve in future programs.</p>

<p>We invite you to follow our future programs and opportunities via <strong>IOMe 254</strong> platforms.</p>

<p>Thank you once again for your commitment to transforming Kenya\u2019s agri-waste sector.</p>

<p>Warm regards,<br>
<strong>The Agri Waste Innovations Team</strong><br>
Airbus \u00d7 KRCS \u2013 IOMe 254</p>
"""


def _get_r1_email_for_r2_response(applicant_name):
    """Try to find an email for a Round 2 Response by matching via Round 2 Applicant name."""
    r2_applicant = frappe.db.get_value(
        "Round 2 Applicant",
        {"applicant_name": applicant_name},
        ["application", "applicant_name"],
        as_dict=True,
    )
    if r2_applicant and r2_applicant.get("application"):
        app = r2_applicant["application"]
        if frappe.db.exists("Agri Waste Innovation", app):
            email     = frappe.db.get_value("Agri Waste Innovation", app, "email") or ""
            full_name = frappe.db.get_value("Agri Waste Innovation", app, "full_name") or ""
            return app, email, full_name
    return None, "", ""


@frappe.whitelist()
def get_r2_finalists():
    """Return all Round 2 Finalists with live R2 judge scores. Coordinator only."""
    if not _is_system_manager(frappe.session.user):
        return {"success": False, "error": "Access denied. Coordinator role required."}
    try:
        rows = frappe.get_all(
            "Round 2 Finalist",
            fields=[
                "name", "r2_response", "applicant_name", "county", "avg_score",
                "r1_application", "email", "added_by", "added_on",
                "finalist_email_sent", "finalist_email_sent_on",
            ],
            order_by="county, applicant_name",
        )
        result = []
        for r in rows:
            # Compute live avg score from judge evaluations
            evals = frappe.get_all(
                "Round 2 Judge Evaluation",
                filters={"r2_applicant": r.r2_response, "docstatus": 1},
                fields=["total_score"],
            )
            live_avg = None
            if evals:
                scores   = [float(e.total_score or 0) for e in evals]
                live_avg = round(sum(scores) / len(scores), 2)

            added_by_name = (
                frappe.db.get_value("User", r.added_by, "full_name") or r.added_by
                if r.added_by else ""
            )
            result.append({
                "name":                   r.name,
                "r2_response":            r.r2_response or "",
                "applicant_name":         r.applicant_name or "",
                "county":                 r.county or "",
                "avg_score":              live_avg if live_avg is not None else (float(r.avg_score or 0)),
                "r1_application":         r.r1_application or "",
                "email":                  r.email or "",
                "added_by":               r.added_by or "",
                "added_by_name":          added_by_name,
                "added_on":               str(r.added_on) if r.added_on else "",
                "finalist_email_sent":    bool(r.finalist_email_sent),
                "finalist_email_sent_on": str(r.finalist_email_sent_on) if r.finalist_email_sent_on else "",
            })
        return {"success": True, "finalists": result}
    except Exception as e:
        frappe.log_error(f"get_r2_finalists error: {str(e)}", "Judging API")
        return {"success": False, "error": str(e)}


@frappe.whitelist()
def add_to_r2_finalists(response_name, avg_score=None):
    """Add a Round 2 Response to the finalist list. Auto-links R1 application if found."""
    if not _is_system_manager(frappe.session.user):
        return {"success": False, "error": "Access denied. Coordinator role required."}
    try:
        if frappe.db.exists("Round 2 Finalist", {"r2_response": response_name}):
            return {"success": False, "error": "Already in the finalist list."}

        if not frappe.db.exists("Round 2 Response", response_name):
            return {"success": False, "error": "Round 2 Response not found."}

        resp = frappe.get_doc("Round 2 Response", response_name)

        # Auto-find R1 application via Round 2 Applicant name match
        r1_app, email, _ = _get_r1_email_for_r2_response(resp.applicant_name)

        doc = frappe.get_doc({
            "doctype":        "Round 2 Finalist",
            "r2_response":    response_name,
            "applicant_name": resp.applicant_name or "",
            "county":         resp.county or "",
            "avg_score":      float(avg_score) if avg_score is not None else 0,
            "r1_application": r1_app,
            "email":          email,
            "added_by":       frappe.session.user,
            "added_on":       frappe.utils.now(),
        })
        doc.insert(ignore_permissions=True)
        frappe.db.commit()

        return {
            "success":     True,
            "finalist":    doc.name,
            "auto_linked": bool(r1_app),
            "email":       email,
        }
    except Exception as e:
        frappe.log_error(f"add_to_r2_finalists error: {str(e)}", "Judging API")
        return {"success": False, "error": str(e)}


@frappe.whitelist()
def remove_from_r2_finalists(response_name):
    """Remove a Round 2 Response from the finalist list. Coordinator only."""
    if not _is_system_manager(frappe.session.user):
        return {"success": False, "error": "Access denied. Coordinator role required."}
    try:
        existing = frappe.db.get_value(
            "Round 2 Finalist", {"r2_response": response_name}, "name"
        )
        if not existing:
            return {"success": False, "error": "Not found in finalist list."}
        frappe.delete_doc("Round 2 Finalist", existing, ignore_permissions=True)
        frappe.db.commit()
        return {"success": True}
    except Exception as e:
        frappe.log_error(f"remove_from_r2_finalists error: {str(e)}", "Judging API")
        return {"success": False, "error": str(e)}


@frappe.whitelist()
def search_r1_applicants(query):
    """Search Round 1 applicants by name or email for manual linking. Coordinator only."""
    if not _is_system_manager(frappe.session.user):
        return {"success": False, "error": "Access denied."}
    try:
        q = (query or "").strip()
        if not q:
            return {"success": True, "results": []}
        results = frappe.db.sql(
            """
            SELECT name, full_name, email, county_of_residence
            FROM `tabAgri Waste Innovation`
            WHERE full_name LIKE %(q)s OR email LIKE %(q)s
            ORDER BY full_name
            LIMIT 20
            """,
            {"q": f"%{q}%"},
            as_dict=True,
        )
        return {"success": True, "results": results}
    except Exception as e:
        frappe.log_error(f"search_r1_applicants error: {str(e)}", "Judging API")
        return {"success": False, "error": str(e)}


@frappe.whitelist()
def link_r1_to_finalist(finalist_name, r1_application_name):
    """Manually link a Round 1 application to a finalist record. Coordinator only."""
    if not _is_system_manager(frappe.session.user):
        return {"success": False, "error": "Access denied. Coordinator role required."}
    try:
        if not frappe.db.exists("Round 2 Finalist", finalist_name):
            return {"success": False, "error": "Finalist record not found."}
        if not frappe.db.exists("Agri Waste Innovation", r1_application_name):
            return {"success": False, "error": "Round 1 application not found."}

        email = frappe.db.get_value("Agri Waste Innovation", r1_application_name, "email") or ""
        frappe.db.set_value("Round 2 Finalist", finalist_name, {
            "r1_application": r1_application_name,
            "email":          email,
        }, update_modified=False)
        frappe.db.commit()
        return {"success": True, "email": email}
    except Exception as e:
        frappe.log_error(f"link_r1_to_finalist error: {str(e)}", "Judging API")
        return {"success": False, "error": str(e)}


@frappe.whitelist()
def get_r2_finalist_email_preview():
    """Preview finalist and regret email recipients. Coordinator only."""
    if not _is_system_manager(frappe.session.user):
        return {"success": False, "error": "Access denied. Coordinator role required."}
    try:
        settings = frappe.get_single("Application Settings")

        # Finalists with and without email
        finalists = frappe.get_all(
            "Round 2 Finalist",
            fields=["name", "applicant_name", "county", "email", "finalist_email_sent"],
            order_by="county, applicant_name",
        )
        with_email    = [f for f in finalists if f.email]
        without_email = [f for f in finalists if not f.email]

        # Non-finalist R2 responses → try to find email via R2 Applicant → R1
        finalist_resp_names = set(
            frappe.db.get_value("Round 2 Finalist", f.name, "r2_response") or ""
            for f in finalists
        )
        all_r2 = frappe.get_all(
            "Round 2 Response",
            fields=["name", "applicant_name", "county"],
            order_by="county, applicant_name",
        )
        regret_list = []
        for r in all_r2:
            if r.name in finalist_resp_names:
                continue
            _, email, _ = _get_r1_email_for_r2_response(r.applicant_name)
            regret_list.append({
                "name":           r.applicant_name or "",
                "r2_response":    r.name,
                "county":         r.county or "",
                "email":          email,
                "has_email":      bool(email),
            })

        return {
            "success":                     True,
            "with_email":                  [
                {
                    "name":                f.applicant_name or "",
                    "county":              f.county or "",
                    "email":               f.email or "",
                    "finalist_email_sent": bool(f.finalist_email_sent),
                }
                for f in with_email
            ],
            "without_email":               [
                {"name": f.applicant_name or "", "county": f.county or ""}
                for f in without_email
            ],
            "regret":                      regret_list,
            "finalist_emails_sent":        bool(settings.r2_finalist_emails_sent),
            "finalist_regret_emails_sent": bool(settings.r2_finalist_regret_emails_sent),
        }
    except Exception as e:
        frappe.log_error(f"get_r2_finalist_email_preview error: {str(e)}", "Judging API")
        return {"success": False, "error": str(e)}


@frappe.whitelist()
def send_r2_finalist_emails():
    """Send finalist notification emails to all finalists who have an email. Coordinator only."""
    if not _is_system_manager(frappe.session.user):
        return {"success": False, "error": "Access denied."}
    try:
        finalists = frappe.get_all(
            "Round 2 Finalist",
            filters={"finalist_email_sent": 0},
            fields=["name", "applicant_name", "email"],
        )
        targets = [f for f in finalists if f.email]

        sent, errors = 0, []
        for f in targets:
            try:
                frappe.sendmail(
                    recipients=[f.email],
                    subject=_FINALIST_SUBJECT,
                    message=_FINALIST_BODY.format(applicant_name=f.applicant_name or "Applicant"),
                    now=True,
                )
                frappe.db.set_value("Round 2 Finalist", f.name, {
                    "finalist_email_sent":    1,
                    "finalist_email_sent_on": frappe.utils.now(),
                }, update_modified=False)
                sent += 1
            except Exception as e:
                errors.append(f"{f.applicant_name}: {str(e)}")
                frappe.log_error(
                    f"Finalist email error for {f.name}: {str(e)}", "Round 2 Finalist Emails"
                )

        settings = frappe.get_single("Application Settings")
        settings.r2_finalist_emails_sent    = 1
        settings.r2_finalist_emails_sent_on = frappe.utils.now()
        settings.save(ignore_permissions=True)
        frappe.db.commit()

        result = {"success": True, "sent": sent, "total": len(targets), "errors": errors}
        if errors:
            result["warning"] = f"Sent {sent}/{len(targets)} emails. {len(errors)} failed."
        else:
            result["message"] = f"Sent {sent} finalist email(s) successfully."
        return result
    except Exception as e:
        frappe.log_error(f"send_r2_finalist_emails error: {str(e)}", "Judging API")
        return {"success": False, "error": str(e)}


@frappe.whitelist()
def send_r2_finalist_regret_emails(force=0):
    """
    Send regret emails to Round 2 respondents who are NOT in the finalist list.
    Looks up emails via Round 2 Applicant → Round 1 application. Coordinator only.
    """
    if not _is_system_manager(frappe.session.user):
        return {"success": False, "error": "Access denied."}
    try:
        settings = frappe.get_single("Application Settings")
        if settings.r2_finalist_regret_emails_sent and not int(force):
            return {
                "success": False,
                "error": "Regret emails already sent. Use force=1 to resend.",
            }

        finalist_resp_names = set(
            r.r2_response for r in frappe.get_all(
                "Round 2 Finalist", fields=["r2_response"]
            )
        )
        all_r2 = frappe.get_all(
            "Round 2 Response",
            fields=["name", "applicant_name"],
        )
        targets = [r for r in all_r2 if r.name not in finalist_resp_names]

        sent, skipped, errors = 0, 0, []
        for r in targets:
            _, email, full_name = _get_r1_email_for_r2_response(r.applicant_name)
            if not email:
                skipped += 1
                errors.append(f"{r.applicant_name}: no email found in Round 1 records")
                continue
            try:
                frappe.sendmail(
                    recipients=[email],
                    subject=_FINALIST_REGRET_SUBJECT,
                    message=_FINALIST_REGRET_BODY.format(
                        applicant_name=full_name or r.applicant_name or "Applicant"
                    ),
                    now=True,
                )
                sent += 1
            except Exception as e:
                errors.append(f"{r.applicant_name}: {str(e)}")
                frappe.log_error(
                    f"Finalist regret email error for {r.name}: {str(e)}",
                    "Round 2 Finalist Emails"
                )

        settings.r2_finalist_regret_emails_sent    = 1
        settings.r2_finalist_regret_emails_sent_on = frappe.utils.now()
        settings.save(ignore_permissions=True)
        frappe.db.commit()

        result = {
            "success": True,
            "sent": sent,
            "skipped": skipped,
            "total": len(targets),
            "errors": errors,
        }
        if skipped or errors:
            result["warning"] = (
                f"Sent {sent}/{len(targets)} emails. "
                f"{skipped} skipped (no email found). "
                f"{len(errors) - skipped} failed."
            )
        else:
            result["message"] = f"Sent {sent} regret email(s) successfully."
        return result
    except Exception as e:
        frappe.log_error(f"send_r2_finalist_regret_emails error: {str(e)}", "Judging API")
        return {"success": False, "error": str(e)}
