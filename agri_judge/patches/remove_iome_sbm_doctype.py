import frappe


def execute():
	"""
	Delete the IOMe SBM and IOMe SBM Business Activity DocTypes after their data
	has been migrated to Social Business Mapping by data_capture_forms.

	Safety: refuses to delete unless every source row has a matching row in
	tabSocial Business Mapping. Guards against deploying agri_judge before
	data_capture_forms's migration patch has run.
	"""
	src_parent = "IOMe SBM"
	src_child = "IOMe SBM Business Activity"
	dst_parent = "Social Business Mapping"

	src_parent_exists = frappe.db.table_exists(src_parent)
	src_child_exists = frappe.db.table_exists(src_child)

	if not src_parent_exists and not src_child_exists:
		return

	if src_parent_exists:
		if not frappe.db.table_exists(dst_parent):
			frappe.log_error(
				title="IOMe SBM cleanup aborted",
				message=(
					"tabSocial Business Mapping does not exist on this site. "
					"Install/update data_capture_forms and run bench migrate "
					"before deploying this patch."
				),
			)
			return

		orphaned = frappe.db.sql(f"""
			SELECT name FROM `tab{src_parent}` src
			WHERE NOT EXISTS (
				SELECT 1 FROM `tab{dst_parent}` dst WHERE dst.name = src.name
			)
			LIMIT 5
		""")
		if orphaned:
			frappe.log_error(
				title="IOMe SBM cleanup aborted",
				message=(
					f"At least {len(orphaned)} IOMe SBM row(s) have no matching "
					f"Social Business Mapping row (sample names: "
					f"{[r[0] for r in orphaned]}). Run the migration patch first."
				),
			)
			return

	# Child first to avoid FK issues; force=1 drops the underlying table.
	if frappe.db.exists("DocType", src_child):
		frappe.delete_doc("DocType", src_child, force=1, ignore_missing=True)
	if frappe.db.exists("DocType", src_parent):
		frappe.delete_doc("DocType", src_parent, force=1, ignore_missing=True)

	frappe.db.commit()
