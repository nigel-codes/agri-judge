import json
import frappe
from frappe import _


@frappe.whitelist(allow_guest=True)
def get_countries():
    countries = frappe.get_all("Country", fields=["name"], order_by="name asc", limit=300)
    return [c["name"] for c in countries]


@frappe.whitelist(allow_guest=True)
def submit_sbm(**kwargs):
    check_fields = {
        "reach_online", "reach_events", "reach_direct_sales", "reach_partnerships", "reach_other",
        "rev_product_sales", "rev_service_contracts", "rev_subscription", "rev_licensing",
        "rev_membership", "rev_consulting", "rev_commission", "rev_procurement", "rev_other",
        "need_funding", "need_biz_dev", "need_impact", "need_legal", "need_marketing",
        "need_market_access", "need_digital", "need_hr", "need_rd", "need_other",
        "str_mission", "str_volunteers", "str_legitimacy", "str_partnerships", "str_financial",
        "str_innovation", "str_leadership", "str_brand", "str_government", "str_scalable",
        "str_rcrc", "str_other",
        "doc_business_plan", "doc_annual_reports", "doc_photos_media", "doc_impact_report",
        "bmt_b2c", "bmt_b2b", "bmt_b2g", "bmt_internal", "bmt_hybrid",
        "pc_individuals", "pc_smes", "pc_large_corp", "pc_government", "pc_schools",
        "pc_hospitals", "pc_community", "pc_other",
        "npc_individuals", "npc_smes", "npc_large_corp", "npc_government", "npc_schools",
        "npc_hospitals", "npc_community", "npc_other",
        "digit_offline", "digit_basic", "digit_online_presence", "digit_ecommerce", "digit_integrated",
    }
    required_parent = [
        "national_society", "broader_program", "legal_status",
        "countries_of_operation", "key_contact_name", "key_contact_title", "key_contact_email",
        "main_business_activity", "social_problem_addressed", "main_sector",
        "funding_type", "annual_revenue_range", "financial_situation",
        "development_stage", "paid_staff_count", "customers_reached_annually",
        "open_to_sharing",
    ]

    # Validate parent required fields
    for field in required_parent:
        if not kwargs.get(field):
            frappe.throw(_("Missing required field: {0}").format(field))

    # Parse child table rows sent as JSON string
    activities_raw = kwargs.pop("business_activities", "[]")
    if isinstance(activities_raw, str):
        try:
            activities = json.loads(activities_raw)
        except (ValueError, TypeError):
            activities = []
    else:
        activities = activities_raw

    if not activities:
        frappe.throw(_("At least one business activity is required."))

    # Validate each activity row
    for i, row in enumerate(activities):
        for f in ("business_activity_name", "matrix_quadrant", "year_of_establishment",
                  "level_of_operation", "hosting_unit"):
            if not row.get(f):
                frappe.throw(_("Row {0}: missing field '{1}' in business activities.").format(i + 1, f))
        row["year_of_establishment"] = frappe.utils.cint(row["year_of_establishment"])
        row["doctype"] = "IOMe SBM Business Activity"

    # Build parent document values
    values = {"doctype": "IOMe SBM"}
    for key, value in kwargs.items():
        if key in check_fields:
            values[key] = 1 if value in (1, "1", True, "true") else 0
        else:
            values[key] = value

    values["business_activities"] = activities

    doc = frappe.get_doc(values)
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"name": doc.name}
