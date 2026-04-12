import frappe


@frappe.whitelist()
def create_imported_user(full_name, email, phone, county, send_welcome_email=0):
    """
    Creates a single User from Excel import data.
    - Splits full_name into first/last name
    - Assigns ONLY the 'Volunteer/Member Approver' role
    - Blocks ALL modules (Allow Modules = none)
    - Creates a User Permission: Company = county
    """

    full_name = (full_name or "").strip()
    email = (email or "").strip()
    phone = (phone or "").strip()
    county = (county or "").strip()

    if not email:
        frappe.throw("Email is required")
    if not full_name:
        frappe.throw(f"Full name is required for {email}")

    # ── Split name ────────────────────────────────────────────────────────
    parts = full_name.split()
    first_name = parts[0]
    last_name = " ".join(parts[1:]) if len(parts) > 1 else ""

    # ── Build user doc ────────────────────────────────────────────────────
    if frappe.db.exists("User", email):
        frappe.throw(f"User {email} already exists")

    user = frappe.new_doc("User")
    user.first_name = first_name
    user.last_name = last_name
    user.email = email
    user.mobile_no = phone
    user.send_welcome_email = int(send_welcome_email)
    user.user_type = "System User"

    # Only this role, nothing else
    user.set("roles", [{"role": "Volunteer/Member Approver"}])

    # Block every module so Allow Modules is fully empty
    from frappe.config import get_modules_from_all_apps

    all_modules = sorted(m.get("module_name") for m in get_modules_from_all_apps())
    user.set("block_modules", [{"module": m} for m in all_modules])

    user.insert(ignore_permissions=True)

    # ── User Permission: Company = county ─────────────────────────────────
    if county:
        perm = frappe.new_doc("User Permission")
        perm.user = email
        perm.allow = "Company"
        perm.for_value = county
        perm.is_default = 1
        perm.apply_to_all_doctypes = 1
        perm.insert(ignore_permissions=True)

    frappe.db.commit()
    return {"status": "ok", "email": email}


@frappe.whitelist()
def get_user_roles(emails):
    """
    Returns roles for a list of emails.
    Accepts emails as a JSON string or list.
    """
    import json as _json
    if isinstance(emails, str):
        emails = _json.loads(emails)

    rows = frappe.db.get_all(
        "Has Role",
        filters={"parent": ["in", emails], "parenttype": "User"},
        fields=["parent", "role"],
        ignore_permissions=True,
    )

    result = {}
    for row in rows:
        result.setdefault(row.parent, []).append(row.role)
    return result
