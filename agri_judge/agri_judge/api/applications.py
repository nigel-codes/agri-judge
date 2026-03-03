"""
Applications API Module
Handles application-related operations
UPDATED: Returns HTML/JSON data instead of generating PDFs
"""

import frappe
from frappe import _
import json


@frappe.whitelist()
def get_application_data(name):
    """
    Get full application data for display as HTML
    
    Args:
        name (str): Agri Waste Innovation document name
    
    Returns:
        dict: Application data with all fields
    """
    try:
        # Check if application exists
        if not frappe.db.exists("Agri Waste Innovation", name):
            return {
                "success": False,
                "error": "Application not found"
            }
        
        # Get the application
        app = frappe.get_doc("Agri Waste Innovation", name)
        
        # Return all fields as dict
        return {
            "success": True,
            "application": {
                "name": app.name,
                "full_name": app.full_name or "",
                "email": app.email or "",
                "gender": app.gender or "",
                "county_of_residence": app.county_of_residence or "",
                "other_county": app.other_county or "",
                "age_group": app.age_group or "",
                "phone_number": app.phone_number or "",
                "prior_experience": app.prior_experience or "",
                "proposed_product": app.proposed_product or "",
                "describe_your_idea": app.describe_your_idea or "",
                "level_of_project": app.level_of_project or "",
                "production_process": app.production_process or "",
                "enviromental_contributions": app.enviromental_contributions or "",
                "monthly_revenue": app.monthly_revenue or "",
                "demonstrate_innovativeness": app.demonstrate_innovativeness or "",
                "use_of_micro_grant": app.use_of_micro_grant or "",
                "enterprise_benefits": app.enterprise_benefits or "",
                "youtube_link": app.youtube_link or "",
                "confirm_commitment": app.confirm_commitment or "",
                "next_step_skills": app.next_step_skills or "",
                "incubator_programs": app.incubator_programs or "",
                "supporting_documents": app.supporting_documents or "",
                "heard_about_program": app.heard_about_program or "",
                "specify_other": app.specify_other or "",
            }
        }
        
    except Exception as e:
        frappe.log_error(f"Error getting application: {str(e)}", "Applications API Error")
        return {
            "success": False,
            "error": str(e)
        }


@frappe.whitelist()
def get_supporting_documents(name):
    """
    Get supporting documents for an application
    
    Args:
        name (str): Agri Waste Innovation document name
    
    Returns:
        dict: List of file URLs
    """
    try:
        if not frappe.db.exists("Agri Waste Innovation", name):
            return {
                "success": False,
                "error": "Application not found"
            }
        
        app = frappe.get_doc("Agri Waste Innovation", name)
        
        # Get attached files
        files = frappe.get_all(
            "File",
            filters={
                "attached_to_doctype": "Agri Waste Innovation",
                "attached_to_name": name
            },
            fields=["file_url", "file_name", "file_size"]
        )
        
        return {
            "success": True,
            "files": files
        }
        
    except Exception as e:
        frappe.log_error(f"Error getting documents: {str(e)}", "Applications API Error")
        return {
            "success": False,
            "error": str(e)
        }