import frappe

def get_context(context):
    context.csrf_token = frappe.session.csrf_token
