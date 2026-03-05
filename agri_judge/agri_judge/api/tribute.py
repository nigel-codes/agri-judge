import os
import frappe
from frappe import _


@frappe.whitelist(allow_guest=True)
def get_tributes():
    tributes = frappe.get_all(
        "Tribute",
        fields=["author_name", "organisation", "category", "message", "submitted_at"],
        order_by="submitted_at desc",
        limit=200,
    )
    return tributes


@frappe.whitelist(allow_guest=True)
def submit_tribute(author_name, message, organisation=None, category=None):
    if not author_name or not message:
        frappe.throw(_("Name and message are required."))

    doc = frappe.get_doc({
        "doctype": "Tribute",
        "author_name": author_name,
        "organisation": organisation or "",
        "category": category or "Community",
        "message": message,
        "submitted_at": frappe.utils.now_datetime(),
    })
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"success": True}


@frappe.whitelist(allow_guest=True)
def get_paybill_info():
    settings = frappe.get_single("Tribute Payment Settings")
    return {
        "paybill_number": settings.paybill_number or "",
        "account_number": settings.account_number or "",
        "organization_name": settings.organization_name or "",
        "payment_instructions": settings.payment_instructions or "",
    }


@frappe.whitelist(allow_guest=True)
def get_gallery_images():
    images_dir = frappe.get_app_path("agri_judge", "www", "images")
    if not os.path.isdir(images_dir):
        return []

    allowed_ext = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
    images = []
    for fname in sorted(os.listdir(images_dir)):
        _, ext = os.path.splitext(fname)
        if ext.lower() in allowed_ext and not fname.startswith("."):
            images.append({"url": f"/images/{fname}", "caption": ""})

    return images
