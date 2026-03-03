"""
Script to rename Agri Waste Innovation records to: Full Name - County format

Run this ONCE after:
1. Setting up the naming expression in Customize Form
2. BEFORE creating new applications

How to run:
1. Go to Frappe Desk
2. Search for "Console" in awesome bar
3. Paste this entire script
4. Click "Run"
"""

import frappe

def rename_agri_waste_applications():
    """
    Rename all Agri Waste Innovation records to format: Full Name - County
    
    Example:
      AWI-2024-0001 → Jane Wanjiku - Kakamega
      AWI-2024-0002 → Peter Omondi - Homabay
    """
    
    print("=" * 70)
    print("Renaming Agri Waste Innovation Applications")
    print("=" * 70)
    
    # Get all applications
    applications = frappe.get_all(
        "Agri Waste Innovation",
        fields=["name", "full_name", "county_of_residence"],
        order_by="creation asc"
    )
    
    if not applications:
        print("No applications found to rename.")
        return
    
    renamed_count = 0
    skipped_count = 0
    error_count = 0
    
    for app in applications:
        old_name = app.name
        full_name = (app.full_name or "").strip()
        county = (app.county_of_residence or "Other").strip()
        
        # Generate new name: "Full Name - County"
        if full_name:
            new_name = f"{full_name} - {county}"
        else:
            # Fallback if no full_name
            new_name = f"Applicant - {county} - {old_name}"
        
        # Check if already in correct format
        if old_name == new_name:
            print(f"  ⏭  Skip: {old_name} (already correct format)")
            skipped_count += 1
            continue
        
        # Check if new name already exists
        if frappe.db.exists("Agri Waste Innovation", new_name):
            print(f"  ⚠  Conflict: Cannot rename {old_name} → {new_name} (name exists)")
            error_count += 1
            continue
        
        # Perform rename
        try:
            frappe.rename_doc(
                "Agri Waste Innovation",
                old_name,
                new_name,
                force=False,
                merge=False
            )
            print(f"  ✓  Renamed: {old_name} → {new_name}")
            renamed_count += 1
        except Exception as e:
            print(f"  ✗  Error renaming {old_name}: {str(e)}")
            error_count += 1
    
    # Commit changes
    frappe.db.commit()
    
    print("\n" + "=" * 70)
    print(f"Summary:")
    print(f"  ✓  Renamed: {renamed_count}")
    print(f"  ⏭  Skipped: {skipped_count}")
    print(f"  ✗  Errors:  {error_count}")
    print(f"  📊 Total:   {len(applications)}")
    print("=" * 70)
    print("\n✅ Done! All applications have been renamed.")
    print("💡 Tip: Existing Judge Evaluations will automatically link to new names.")

# Run the script
rename_agri_waste_applications()
