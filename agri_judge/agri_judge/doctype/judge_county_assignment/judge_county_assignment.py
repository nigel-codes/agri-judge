import frappe
from frappe.model.document import Document


class JudgeCountyAssignment(Document):
    def validate(self):
        # Ensure the user actually has the Judge role
        user_roles = frappe.get_roles(self.judge)
        if "Judge" not in user_roles and "System Manager" not in user_roles:
            frappe.throw(
                f"User {self.judge} does not have the Judge role. "
                "Please assign the Judge role first."
            )
