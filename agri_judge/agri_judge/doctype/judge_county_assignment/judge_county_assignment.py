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

        # Prevent duplicate (judge, county) pairs
        existing = frappe.db.get_value(
            "Judge County Assignment",
            {"judge": self.judge, "assigned_county": self.assigned_county, "name": ["!=", self.name]},
            "name",
        )
        if existing:
            frappe.throw(
                f"{self.judge} is already assigned to {self.assigned_county}. "
                "Each judge can only have one assignment per county."
            )
