import frappe
from frappe import _


@frappe.whitelist(allow_guest=True)
def submit_sbm(**kwargs):
    int_fields = {"year_of_establishment"}
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
    }
    required = [
        "national_society", "business_activity_name", "matrix_quadrant",
        "year_of_establishment", "level_of_operation", "hosting_unit", "broader_program",
        "legal_status", "countries_of_operation", "key_contact",
        "main_business_activity", "social_problem_addressed", "main_sector",
        "business_model_type", "paying_customers",
        "funding_type", "annual_revenue_range", "financial_situation",
        "development_stage", "paid_staff_count", "customers_reached_annually",
        "open_to_sharing",
    ]

    for field in required:
        if not kwargs.get(field):
            frappe.throw(_("Missing required field: {0}").format(field))

    values = {}
    for key, value in kwargs.items():
        if key in int_fields:
            values[key] = frappe.utils.cint(value)
        elif key in check_fields:
            values[key] = 1 if value in (1, "1", True, "true") else 0
        else:
            values[key] = value

    values["doctype"] = "IOMe SBM"

    doc = frappe.get_doc(values)
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"name": doc.name}
