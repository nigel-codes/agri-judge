frappe.ui.form.on("Award Email Batch", {
    refresh(frm) {
        // ── Send Winners Button ───────────────────────────────
        if (frm.doc.status === "Draft" && !frm.is_new()) {
            frm.add_custom_button(__("🏆 Send Congratulations Emails"), function () {
                const winner_count = (frm.doc.winners || []).length;
                if (winner_count === 0) {
                    frappe.msgprint({
                        title: __("No Winners"),
                        message: __("Please add winners to the table before sending."),
                        indicator: "orange",
                    });
                    return;
                }

                frappe.confirm(
                    `Send congratulations emails to <b>${winner_count} winner(s)</b>?<br><br>
                     <small>⚠️ This cannot be undone. Winners will receive their emails immediately.</small>`,
                    () => {
                        frappe.call({
                            method: "agri_judge.agri_judge.doctype.award_email_batch.award_email_batch.send_winner_emails",
                            args: { batch_name: frm.doc.name },
                            freeze: true,
                            freeze_message: __("Sending congratulations emails..."),
                            callback(r) {
                                if (r.message) {
                                    const res = r.message;
                                    const indicator = res.errors?.length ? "orange" : "green";
                                    const msg = res.warning || res.message;
                                    frappe.msgprint({ title: __("Emails Sent"), message: msg, indicator });
                                    frm.reload_doc();
                                }
                            },
                        });
                    }
                );
            }, __("Email Actions")).addClass("btn-primary");
        }

        // ── Send Regrets Button ───────────────────────────────
        if (frm.doc.status === "Winners Notified" && !frm.is_new()) {
            const all_count_note = __("All applicants NOT in the winners list will receive a regret email.");
            frm.add_custom_button(__("📩 Send Regret Emails"), function () {
                frappe.confirm(
                    `Send regret emails to all non-winning applicants?<br><br>
                     <small>${all_count_note}</small><br>
                     <small>⚠️ This cannot be undone.</small>`,
                    () => {
                        frappe.call({
                            method: "agri_judge.agri_judge.doctype.award_email_batch.award_email_batch.send_regret_emails",
                            args: { batch_name: frm.doc.name },
                            freeze: true,
                            freeze_message: __("Sending regret emails..."),
                            callback(r) {
                                if (r.message) {
                                    const res = r.message;
                                    const indicator = res.errors?.length ? "orange" : "green";
                                    const msg = res.warning || res.message;
                                    frappe.msgprint({ title: __("Emails Sent"), message: msg, indicator });
                                    frm.reload_doc();
                                }
                            },
                        });
                    }
                );
            }, __("Email Actions")).addClass("btn-warning");
        }

        // ── Quick Add Winners Button ──────────────────────────
        if (frm.doc.status === "Draft" && !frm.is_new()) {
            frm.add_custom_button(__("➕ Pick Winners from Leaderboard"), function () {
                _open_winner_picker(frm);
            }, __("Email Actions"));
        }

        // ── Status colour indicators ─────────────────────────
        const colours = {
            "Draft":             "grey",
            "Winners Notified":  "orange",
            "All Notified":      "green",
        };
        frm.set_indicator_formatter("status", () => colours[frm.doc.status] || "grey");
    },
});


// ── Winner Picker Dialog ──────────────────────────────────────
function _open_winner_picker(frm) {
    frappe.call({
        method: "agri_judge.agri_judge.doctype.award_email_batch.award_email_batch.get_all_applications_for_picker",
        callback(r) {
            if (!r.message) return;

            const apps = r.message;

            // Build already-added set
            const already_added = new Set(
                (frm.doc.winners || []).map(w => w.application)
            );

            // Build table rows HTML
            const rows = apps.map(app => {
                const checked = already_added.has(app.name) ? "checked disabled" : "";
                const disabled_cls = already_added.has(app.name) ? "style='color:#999;'" : "";
                return `
                    <tr>
                        <td style="padding:6px 8px;">
                            <input type="checkbox" class="winner-check" value="${app.name}"
                                data-name="${frappe.utils.escape_html(app.full_name || app.name)}"
                                data-email="${frappe.utils.escape_html(app.email || '')}"
                                data-county="${frappe.utils.escape_html(app.county_of_residence || '')}"
                                ${checked}/>
                        </td>
                        <td style="padding:6px 8px;" ${disabled_cls}>
                            <strong>${frappe.utils.escape_html(app.full_name || app.name)}</strong>
                        </td>
                        <td style="padding:6px 8px;" ${disabled_cls}>${frappe.utils.escape_html(app.county_of_residence || "—")}</td>
                        <td style="padding:6px 8px;" ${disabled_cls}>${frappe.utils.escape_html(app.level_of_project || "—")}</td>
                        <td style="padding:6px 8px;" ${disabled_cls}>${frappe.utils.escape_html(app.gender || "—")}</td>
                    </tr>`;
            }).join("");

            const dialog = new frappe.ui.Dialog({
                title: __("Select Winners"),
                size: "large",
                fields: [
                    {
                        fieldtype: "HTML",
                        fieldname: "picker_html",
                        options: `
                            <div style="max-height:420px;overflow-y:auto;">
                                <table style="width:100%;border-collapse:collapse;font-size:13px;">
                                    <thead style="background:#f5f5f5;position:sticky;top:0;">
                                        <tr>
                                            <th style="padding:8px;width:36px;"></th>
                                            <th style="padding:8px;text-align:left;">Applicant</th>
                                            <th style="padding:8px;text-align:left;">County</th>
                                            <th style="padding:8px;text-align:left;">Stage</th>
                                            <th style="padding:8px;text-align:left;">Gender</th>
                                        </tr>
                                    </thead>
                                    <tbody>${rows}</tbody>
                                </table>
                            </div>`,
                    },
                ],
                primary_action_label: __("Add Selected as Winners"),
                primary_action() {
                    const checked = dialog.$wrapper.find(".winner-check:checked:not(:disabled)");
                    if (checked.length === 0) {
                        frappe.msgprint(__("No new winners selected."));
                        return;
                    }

                    checked.each(function () {
                        const app_name    = $(this).val();
                        const full_name   = $(this).data("name");
                        const email_addr  = $(this).data("email");
                        const county_val  = $(this).data("county");

                        frm.add_child("winners", {
                            application:     app_name,
                            applicant_name:  full_name,
                            applicant_email: email_addr,
                            county:          county_val,
                        });
                    });

                    frm.refresh_field("winners");
                    frappe.show_alert({ message: __(`${checked.length} winner(s) added`), indicator: "green" });
                    dialog.hide();
                },
            });

            dialog.show();
        },
    });
}
