import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime
import re


class AwardEmailBatch(Document):
    pass


# ─────────────────────────────────────────────────────────────
#  Whitelisted API methods called from the JS buttons
# ─────────────────────────────────────────────────────────────

@frappe.whitelist()
def send_winner_emails(batch_name):
    """
    Send congratulations emails to every applicant in the Winners table.
    Can only be called once (status must be Draft).
    """
    batch = frappe.get_doc("Award Email Batch", batch_name)

    if batch.status != "Draft":
        frappe.throw(
            f"Winner emails have already been sent (status: {batch.status}). "
            "You cannot send them again."
        )

    if not batch.winners:
        frappe.throw("Please add at least one winner before sending emails.")

    sent = 0
    errors = []

    for row in batch.winners:
        try:
            app = frappe.get_doc("Agri Waste Innovation", row.application)
            email = app.email
            if not email:
                errors.append(f"{row.applicant_name}: no email address on file")
                continue

            body = _render_template(
                batch.winner_email_body,
                applicant_name=app.full_name or row.applicant_name,
                county=app.county_of_residence or "",
            )

            frappe.sendmail(
                recipients=[email],
                subject=batch.winner_email_subject,
                message=body,
                now=True,           # send immediately, not via queue delay
            )
            sent += 1

        except Exception as e:
            errors.append(f"{row.applicant_name}: {str(e)}")
            frappe.log_error(
                f"Winner email error for {row.application}: {str(e)}",
                "Award Email Batch"
            )

    # Update status and stats
    batch.status = "Winners Notified"
    batch.winners_sent_on = now_datetime()
    batch.total_winners = sent
    batch.save(ignore_permissions=True)
    frappe.db.commit()

    result = {
        "sent": sent,
        "total": len(batch.winners),
        "errors": errors,
    }

    if errors:
        result["warning"] = f"Sent {sent}/{len(batch.winners)} emails. {len(errors)} failed."
    else:
        result["message"] = f"Successfully sent {sent} congratulations email(s)."

    return result


@frappe.whitelist()
def send_regret_emails(batch_name):
    """
    Send regret emails to ALL applicants who are NOT in the winners table.
    Can only be called after winner emails have been sent.
    """
    batch = frappe.get_doc("Award Email Batch", batch_name)

    if batch.status == "Draft":
        frappe.throw(
            "Please send winner emails first before sending regret emails. "
            "This ensures winners receive their congratulations before regrets go out."
        )

    if batch.status == "All Notified":
        frappe.throw("Regret emails have already been sent for this batch.")

    # Build set of winner application names to exclude
    winner_names = {row.application for row in (batch.winners or [])}

    # Get all applicants NOT in the winners list
    all_apps = frappe.get_all(
        "Agri Waste Innovation",
        fields=["name", "full_name", "email", "county_of_residence"],
    )

    non_winners = [a for a in all_apps if a.name not in winner_names]

    if not non_winners:
        frappe.throw("There are no non-winner applicants to send regret emails to.")

    sent = 0
    errors = []

    for app in non_winners:
        try:
            email = app.email
            if not email:
                errors.append(f"{app.full_name}: no email address on file")
                continue

            body = _render_template(
                batch.regret_email_body,
                applicant_name=app.full_name or app.name,
                county=app.county_of_residence or "",
            )

            frappe.sendmail(
                recipients=[email],
                subject=batch.regret_email_subject,
                message=body,
                now=True,
            )
            sent += 1

        except Exception as e:
            errors.append(f"{app.full_name}: {str(e)}")
            frappe.log_error(
                f"Regret email error for {app.name}: {str(e)}",
                "Award Email Batch"
            )

    batch.status = "All Notified"
    batch.regret_sent_on = now_datetime()
    batch.total_regrets_sent = sent
    batch.save(ignore_permissions=True)
    frappe.db.commit()

    result = {
        "sent": sent,
        "total": len(non_winners),
        "errors": errors,
    }

    if errors:
        result["warning"] = (
            f"Sent {sent}/{len(non_winners)} regret emails. {len(errors)} failed."
        )
    else:
        result["message"] = f"Successfully sent {sent} regret email(s)."

    return result


@frappe.whitelist()
def get_all_applications_for_picker():
    """
    Returns a lightweight list of all applications for the winner picker dialog.
    """
    apps = frappe.get_all(
        "Agri Waste Innovation",
        fields=["name", "full_name", "email", "county_of_residence", "level_of_project", "gender"],
        order_by="full_name asc",
    )
    return apps


def _render_template(template_html, **kwargs):
    """
    Simple {placeholder} substitution in email body.
    Supports: {applicant_name}, {county}
    """
    result = template_html
    for key, value in kwargs.items():
        result = result.replace("{" + key + "}", str(value or ""))
    return result
