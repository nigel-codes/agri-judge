/**
 * Round 2 Finalists
 * Coordinator-only. Select finalists from scored Round 2 responses and email them.
 * - Shows all finalists grouped by county with their R2 judge scores
 * - Add finalists from all R2 responses not yet in the list
 * - Link each finalist to their Round 1 application to retrieve email
 * - Send finalist and regret emails
 */

frappe.pages['round-2-finalists'].on_page_load = function(wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Round 2 Finalists',
        single_column: true
    });
    page.add_button('Home', () => frappe.set_route('/app'), 'octicon octicon-home');
    page.add_button('R2 Leaderboard', () => frappe.set_route('round-2-leaderboard'), 'octicon octicon-list-ordered');
    page.add_button('Round 2 Applicants', () => frappe.set_route('round-2-applicants'), 'octicon octicon-law');
    page.set_primary_action('Refresh', () => wrapper._fin && wrapper._fin.load(), 'octicon octicon-sync');
    page.add_button('✉ Send Emails', () => wrapper._fin && wrapper._fin.openEmailPanel(), 'octicon octicon-mail');
    wrapper._fin = new R2FinalistsPage(page, wrapper);
};

frappe.pages['round-2-finalists'].on_page_show = function(wrapper) {
    if (wrapper._fin) wrapper._fin.load();
};

class R2FinalistsPage {
    constructor(page, wrapper) {
        this.page    = page;
        this.wrapper = $(wrapper).find('.page-content');
        this.data    = [];
    }

    load() {
        this.wrapper.html(this.loadingHtml());
        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.get_r2_finalists',
            callback: (r) => {
                if (r.message && r.message.success) {
                    this.data = r.message.finalists || [];
                    this.render();
                } else {
                    this.renderError(r.message?.error || 'Failed to load Round 2 Finalists.');
                }
            }
        });
    }

    render() {
        const total      = this.data.length;
        const withEmail  = this.data.filter(f => f.email).length;
        const noEmail    = this.data.filter(f => !f.email).length;
        const emailsSent = this.data.filter(f => f.finalist_email_sent).length;

        const byCounty = {};
        this.data.forEach(f => {
            const c = f.county || 'Unknown';
            if (!byCounty[c]) byCounty[c] = [];
            byCounty[c].push(f);
        });

        const countyColors = {
            'Kakamega': '#1565C0', 'Homabay': '#2E7D32',
            'Kericho': '#E65100', 'Meru': '#6A1B9A', 'Other': '#37474F',
        };

        const countySections = Object.keys(byCounty).sort().map(county => {
            const apps  = byCounty[county];
            const color = countyColors[county] || '#37474F';
            return `
            <div class="fin-county-card">
                <div class="fin-county-header" style="border-left-color:${color};">
                    <div class="fin-county-title" style="color:${color};">
                        <span class="county-dot" style="background:${color};"></span>
                        ${frappe.utils.escape_html(county)}
                    </div>
                    <div class="fin-county-count">${apps.length} finalist${apps.length !== 1 ? 's' : ''}</div>
                </div>
                <div class="fin-table">
                    <div class="fin-table-head">
                        <div>Applicant</div>
                        <div>R2 Avg Score</div>
                        <div>Email</div>
                        <div>Email Sent</div>
                        <div></div>
                    </div>
                    ${apps.map(f => this.renderRow(f)).join('')}
                </div>
            </div>`;
        }).join('');

        this.wrapper.html(`
            ${this.getStyles()}
            <div class="fin-wrap">

                <div class="fin-header">
                    <div class="fin-header-inner">
                        <div>
                            <h1>🏆 Round 2 Finalists</h1>
                            <p class="fin-subtitle">Applications selected as finalists after Round 2 judging — link Round 1 records to retrieve emails</p>
                        </div>
                        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                            <div class="view-badge">🎯 Coordinator</div>
                            <button class="btn-export" onclick="window._finExport && window._finExport()">⬇ Export CSV</button>
                        </div>
                    </div>
                </div>

                <div class="fin-stats">
                    ${this.statCard(total,      'Total Finalists',        '#1565C0')}
                    ${this.statCard(withEmail,  'Email Found (via R1)',   '#2E7D32')}
                    ${this.statCard(noEmail,    'Missing Email',          '#E65100')}
                    ${this.statCard(emailsSent, 'Finalist Email Sent',    '#6A1B9A')}
                </div>

                ${noEmail > 0 ? `
                <div class="fin-warning">
                    ⚠ <strong>${noEmail} finalist${noEmail !== 1 ? 's' : ''}</strong>
                    ${noEmail !== 1 ? 'have' : 'has'} no email address linked.
                    Use the <strong>Link Round 1</strong> button to search and connect the correct Round 1 application.
                </div>` : ''}

                <div style="margin-bottom:18px;">
                    <button class="btn-add-more" id="btnShowAddPanel">
                        + Add More Finalists
                    </button>
                </div>

                <div class="add-panel" id="addPanel" style="display:none;">
                    <div class="add-panel-header">
                        <strong>Add Finalists from Round 2 Responses</strong>
                        <button class="add-panel-close" id="btnCloseAddPanel">✕</button>
                    </div>
                    <div id="addPanelContent">
                        <div style="padding:20px;text-align:center;color:#888;">Loading Round 2 responses…</div>
                    </div>
                </div>

                ${total === 0
                    ? `<div class="fin-empty">
                           <div style="font-size:52px;margin-bottom:16px;">🏅</div>
                           <strong>No finalists selected yet.</strong>
                           <p>Click <em>Add More Finalists</em> above to select from scored Round 2 responses.</p>
                       </div>`
                    : countySections}

                ${this.getFooter()}
            </div>
        `);

        this.wrapper.on('click', '.btn-remove', (e) => {
            const btn   = $(e.currentTarget);
            const resp  = btn.data('resp');
            const label = btn.data('label');
            frappe.confirm(
                `Remove <strong>${frappe.utils.escape_html(label)}</strong> from the finalist list?`,
                () => this.removeFinalist(resp, btn.closest('.fin-table-row'))
            );
        });

        this.wrapper.on('click', '.btn-view-app', (e) => {
            const btn   = $(e.currentTarget);
            const resp  = btn.data('resp');
            const fname = btn.data('finalist') || null;
            this.openViewDialog(resp, fname);
        });

        this.wrapper.find('#btnShowAddPanel').on('click', () => this.openAddPanel());
        this.wrapper.find('#btnCloseAddPanel').on('click', () => {
            this.wrapper.find('#addPanel').slideUp(200);
        });

        window._finExport = () => this.exportCSV();
    }

    renderRow(f) {
        const emailCell = f.email
            ? `<div class="email-cell has-email" title="${frappe.utils.escape_html(f.email)}">
                   <span class="email-icon">✉</span>
                   <span class="email-text">${frappe.utils.escape_html(f.email)}</span>
               </div>`
            : `<div class="email-cell no-email" title="Open application to link Round 1">
                   <span>⚠ No email</span>
               </div>`;

        const sentBadge = f.finalist_email_sent
            ? `<span class="badge badge-sent">✓ Sent</span>`
            : `<span class="badge badge-pending">Pending</span>`;

        const score = f.avg_score > 0 ? f.avg_score.toFixed(1) : '—';
        const scoreClass = f.avg_score >= 60 ? 'score-green' : f.avg_score > 0 ? 'score-orange' : 'score-neutral';

        return `
        <div class="fin-table-row">
            <div class="app-name-cell">
                <div class="app-name">${frappe.utils.escape_html(f.applicant_name)}</div>
                <div class="app-sub">${frappe.utils.escape_html(f.county || '')}</div>
            </div>
            <div class="score-cell ${scoreClass}">${score}</div>
            <div>${emailCell}</div>
            <div>${sentBadge}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button class="btn-view-app"
                        data-resp="${frappe.utils.escape_html(f.r2_response)}"
                        data-finalist="${frappe.utils.escape_html(f.name)}">
                    View
                </button>
                <button class="btn-remove"
                        data-resp="${frappe.utils.escape_html(f.r2_response)}"
                        data-label="${frappe.utils.escape_html(f.applicant_name)}">
                    Remove
                </button>
            </div>
        </div>`;
    }

    removeFinalist(responseName, rowEl) {
        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.remove_from_r2_finalists',
            args: { response_name: responseName },
            callback: (r) => {
                if (r.message && r.message.success) {
                    rowEl.fadeOut(250, () => rowEl.remove());
                    this.data = this.data.filter(f => f.r2_response !== responseName);
                    frappe.show_alert({ message: 'Removed from finalist list', indicator: 'orange' });
                } else {
                    frappe.show_alert({ message: r.message?.error || 'Failed to remove', indicator: 'red' });
                }
            }
        });
    }

    openAddPanel() {
        const panel = this.wrapper.find('#addPanel');
        panel.slideDown(200);
        this.wrapper.find('#addPanelContent').html(
            '<div style="padding:20px;text-align:center;color:#888;">Loading Round 2 responses…</div>'
        );

        const currentResps = new Set(this.data.map(f => f.r2_response));

        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.get_r2_scoring_progress',
            callback: (r) => {
                if (!r.message || !r.message.success) {
                    this.wrapper.find('#addPanelContent').html(
                        '<div style="padding:20px;color:#C62828;">Failed to load Round 2 responses.</div>'
                    );
                    return;
                }
                const eligible = (r.message.applicants || []).filter(
                    row => !currentResps.has(row.r2_applicant)
                );

                if (!eligible.length) {
                    this.wrapper.find('#addPanelContent').html(
                        '<div style="padding:20px;text-align:center;color:#888;">All Round 2 applicants are already in the finalist list.</div>'
                    );
                    return;
                }

                const rows = eligible.map(a => {
                    const hasScore = a.avg_total_score !== null && a.avg_total_score !== undefined;
                    const score    = hasScore ? parseFloat(a.avg_total_score).toFixed(1) : '—';
                    const cls      = !hasScore ? 'score-neutral' : a.passes_cutoff ? 'score-green' : 'score-orange';
                    const badge    = !hasScore
                        ? '<span class="badge badge-neutral">Not scored</span>'
                        : a.passes_cutoff
                            ? '<span class="badge badge-pass">✓ Passes Cut-off</span>'
                            : '<span class="badge badge-fail">Below Cut-off</span>';
                    return `
                    <div class="add-row">
                        <div class="app-name-cell">
                            <div class="app-name">${frappe.utils.escape_html(a.applicant_name)}</div>
                            <div class="app-sub">${frappe.utils.escape_html(a.county || '')}</div>
                        </div>
                        <div class="score-cell ${cls}">${score}</div>
                        <div>${badge}</div>
                        <div style="display:flex;gap:6px;flex-wrap:wrap;">
                            <button class="btn-view-preview"
                                    data-resp="${frappe.utils.escape_html(a.r2_applicant)}">
                                View
                            </button>
                            <button class="btn-add-finalist btn-select"
                                    data-resp="${frappe.utils.escape_html(a.r2_applicant)}"
                                    data-avg="${hasScore ? a.avg_total_score : 0}">
                                + Add as Finalist
                            </button>
                        </div>
                    </div>`;
                }).join('');

                this.wrapper.find('#addPanelContent').html(`
                    <div class="add-table-head">
                        <div>Applicant</div><div>R2 Avg Score</div><div>Status</div><div>Actions</div>
                    </div>
                    ${rows}
                `);

                this.wrapper.find('.btn-view-preview').on('click', (e) => {
                    const resp = $(e.currentTarget).data('resp');
                    this.openViewDialog(resp, null);
                });

                this.wrapper.find('.btn-add-finalist').on('click', (e) => {
                    const btn  = $(e.currentTarget);
                    const resp = btn.data('resp');
                    const avg  = parseFloat(btn.data('avg') || 0);
                    btn.prop('disabled', true).text('Adding…');
                    frappe.call({
                        method: 'agri_judge.agri_judge.api.judging.add_to_r2_finalists',
                        args: { response_name: resp, avg_score: avg },
                        callback: (r) => {
                            if (r.message && r.message.success) {
                                btn.closest('.add-row').fadeOut(200, function() { $(this).remove(); });
                                const linked = r.message.auto_linked;
                                const msg = linked
                                    ? `Added as finalist — R1 application auto-linked (email: ${r.message.email || 'found'})`
                                    : 'Added as finalist — no matching R1 application found, please link manually';
                                frappe.show_alert({
                                    message: msg,
                                    indicator: linked ? 'green' : 'orange'
                                }, 6);
                                setTimeout(() => this.load(), 400);
                            } else {
                                btn.prop('disabled', false).text('+ Add as Finalist');
                                frappe.show_alert({ message: r.message?.error || 'Failed', indicator: 'red' });
                            }
                        }
                    });
                });
            }
        });
    }

    openViewDialog(responseName, finalistName) {
        const d = new frappe.ui.Dialog({
            title: 'Round 2 Application',
            size: 'extra-large',
        });
        d.body.innerHTML = `<div style="padding:20px;text-align:center;color:#888;">
            <div style="font-size:28px;margin-bottom:8px;">⏳</div><p>Loading application…</p>
        </div>`;
        d.show();

        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.get_round2_response_for_review',
            args: { response_name: responseName },
            callback: (r) => {
                if (!r.message || !r.message.success) {
                    d.body.innerHTML = `<div style="color:#C62828;padding:20px;">
                        ${frappe.utils.escape_html(r.message?.error || 'Failed to load application.')}
                    </div>`;
                    return;
                }
                const res         = r.message.response;
                const r1          = r.message.round1_application || null;
                const atts        = r.message.attachments || [];
                const judgeScores = r.message.judge_scores || [];
                const avgScore    = r.message.avg_score;
                d.set_title(frappe.utils.escape_html(res.applicant_name));
                d.body.innerHTML = this._viewDialogHtml(res, atts, r1, finalistName, judgeScores, avgScore);
                if (finalistName) this._wireR2Link(d, finalistName);
            }
        });
    }

    _viewDialogHtml(res, atts, r1, finalistName, judgeScores, avgScore) {
        const field = (label, value) => {
            if (!value && value !== 0) return '';
            return `<div class="vd-field">
                <div class="vd-label">${label}</div>
                <div class="vd-value">${frappe.utils.escape_html(String(value))}</div>
            </div>`;
        };
        const richField = (label, value) => {
            if (!value) return '';
            return `<div class="vd-field">
                <div class="vd-label">${label}</div>
                <div class="vd-value vd-rich">${value}</div>
            </div>`;
        };

        const county = res.county === 'Other' && res.county_other ? res.county_other : res.county;

        let attHtml = '';
        if (atts.length) {
            attHtml = `<div class="vd-field"><div class="vd-label">Attachments</div><div class="vd-value">` +
                atts.map(f => `<a href="${frappe.utils.escape_html(f.file_url)}" target="_blank" class="vd-attach">
                    📎 ${frappe.utils.escape_html(f.file_name)}</a>`).join('') +
            `</div></div>`;
        }

        // Judge scores section
        let judgeHtml = '';
        if (judgeScores && judgeScores.length) {
            const scoreRows = judgeScores.map(j => `
                <div class="js-row">
                    <div class="js-judge">${frappe.utils.escape_html(j.judge_name)}</div>
                    <div class="js-val">${j.subtotal}</div>
                    <div class="js-val">${j.tech_bonus > 0 ? '+' + j.tech_bonus : '—'}</div>
                    <div class="js-val">${j.leverage > 0 ? '+' + j.leverage : '—'}</div>
                    <div class="js-total ${j.passes_cutoff ? 'js-pass' : 'js-fail'}">${j.total}</div>
                </div>`).join('');
            const avgDisplay = avgScore != null ? avgScore.toFixed(1) : '—';
            judgeHtml = `
            <div class="vd-section-head">Judge Scores</div>
            <div class="js-table">
                <div class="js-head">
                    <div>Judge</div><div>Subtotal</div><div>Tech</div><div>Leverage</div><div>Total</div>
                </div>
                ${scoreRows}
                <div class="js-avg-row">
                    <div>Average</div><div></div><div></div><div></div>
                    <div class="js-avg">${avgDisplay}</div>
                </div>
            </div>`;
        } else {
            judgeHtml = `<div class="vd-section-head">Judge Scores</div>
                <div style="font-size:13px;color:#aaa;font-style:italic;margin-bottom:14px;">No judge evaluations submitted yet.</div>`;
        }

        const linkSection = finalistName ? `
            <div class="vd-section-head">Link Email via Round 2 Applicants</div>
            <p style="font-size:12px;color:#888;margin:0 0 8px;">
                Search by name, county or email to find this applicant and link their email address.
            </p>
            <input type="text" id="r2LinkFilter" class="r2-link-input"
                   placeholder="Filter by name, county or email…" autocomplete="off">
            <div id="r2LinkList" style="margin-top:8px;">
                <div style="padding:8px;color:#aaa;font-size:13px;">Loading…</div>
            </div>
        ` : '';

        return `
        ${this._viewDialogStyles()}
        <div class="vd-wrap">
            <div class="vd-chips">
                <span class="vd-chip">📍 ${frappe.utils.escape_html(county || '—')}</span>
                ${res.gender ? `<span class="vd-chip">${frappe.utils.escape_html(res.gender)}</span>` : ''}
                ${res.age ? `<span class="vd-chip">Age ${res.age}</span>` : ''}
                ${res.is_tech_enabled ? '<span class="vd-chip vd-chip-tech">Tech-enabled</span>' : ''}
            </div>
            <div class="vd-section-head">Round 2 Submission</div>
            ${field('Developmental Level', res.developmental_level)}
            ${richField('Innovation / Project Description', res.innovation_description)}
            ${richField('Resources & Skills Needed', res.resources_needed)}
            ${attHtml}
            ${judgeHtml}
            ${linkSection}
        </div>`;
    }

    _wireR2Link(d, finalistName) {
        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.get_r2_applicants_with_email',
            callback: (r) => {
                if (!r.message || !r.message.success) {
                    d.body.querySelector('#r2LinkList').innerHTML =
                        '<div style="color:#C62828;font-size:13px;">Failed to load applicants.</div>';
                    return;
                }
                const all = r.message.applicants || [];

                const renderList = (items) => {
                    const el = d.body.querySelector('#r2LinkList');
                    if (!items.length) {
                        el.innerHTML = '<div style="padding:6px;color:#aaa;font-size:13px;">No matches.</div>';
                        return;
                    }
                    el.innerHTML = `<div class="r2l-list">` + items.map(a => `
                        <div class="r2l-row">
                            <div class="r2l-info">
                                <div class="r2l-name">${frappe.utils.escape_html(a.applicant_name)}</div>
                                <div class="r2l-sub">${frappe.utils.escape_html(a.county || '')}${a.email ? ' · ' + frappe.utils.escape_html(a.email) : ' · (no email)'}</div>
                            </div>
                            <button class="r2l-btn" data-r1="${frappe.utils.escape_html(a.r1_application)}">
                                Link
                            </button>
                        </div>`).join('') + `</div>`;

                    el.querySelectorAll('.r2l-btn').forEach(btn => {
                        btn.addEventListener('click', () => {
                            btn.disabled = true;
                            btn.textContent = '…';
                            frappe.call({
                                method: 'agri_judge.agri_judge.api.judging.link_r1_to_finalist',
                                args: { finalist_name: finalistName, r1_application_name: btn.dataset.r1 },
                                callback: (r) => {
                                    d.hide();
                                    if (r.message && r.message.success) {
                                        frappe.show_alert({
                                            message: `Linked! Email: ${r.message.email || '(none on record)'}`,
                                            indicator: 'green'
                                        }, 5);
                                        this.load();
                                    } else {
                                        frappe.show_alert({ message: r.message?.error || 'Failed to link', indicator: 'red' });
                                    }
                                }
                            });
                        });
                    });
                };

                renderList(all);

                const filterInput = d.body.querySelector('#r2LinkFilter');
                filterInput?.addEventListener('input', () => {
                    const q = filterInput.value.toLowerCase().trim();
                    renderList(q ? all.filter(a =>
                        (a.applicant_name || '').toLowerCase().includes(q) ||
                        (a.county || '').toLowerCase().includes(q) ||
                        (a.email || '').toLowerCase().includes(q)
                    ) : all);
                });
            }
        });
    }

    openEmailPanel() {
        const dial = new frappe.ui.Dialog({
            title: '✉ Send Round 2 Finalist Emails',
            size: 'large',
        });
        dial.body.innerHTML = `<div style="padding:10px 0 6px;text-align:center;color:#888;">
            <div style="font-size:28px;margin-bottom:8px;">⏳</div>
            <p>Loading email preview…</p>
        </div>`;
        dial.show();

        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.get_r2_finalist_email_preview',
            callback: (r) => {
                if (!r.message || !r.message.success) {
                    dial.body.innerHTML = `<div style="color:#C62828;padding:20px;">
                        Failed to load preview: ${frappe.utils.escape_html(r.message?.error || 'Unknown error')}
                    </div>`;
                    return;
                }
                dial.body.innerHTML = this.emailPanelHtml(r.message);
                this.wireEmailButtons(dial, r.message);
            }
        });
    }

    emailPanelHtml(m) {
        const sentBadge = (sent) => sent
            ? `<span class="email-sent-badge">✓ Sent</span>`
            : `<span class="email-pending-badge">Not sent</span>`;

        const recipientRows = (list, showEmail) => list.length === 0
            ? `<div style="padding:10px 16px;color:#aaa;font-size:13px;">No recipients in this group.</div>`
            : list.map(r => `
                <div class="ep-row">
                    <div>
                        <div style="font-weight:700;font-size:13px;">${frappe.utils.escape_html(r.name)}</div>
                        <div style="font-size:11px;color:#aaa;">
                            ${frappe.utils.escape_html(r.county || '')}
                            ${showEmail && r.email ? ' · ' + frappe.utils.escape_html(r.email) : ''}
                        </div>
                    </div>
                    <div style="font-size:11px;color:#888;">
                        ${showEmail && !r.email ? '<span style="color:#E65100;">⚠ No email</span>' : ''}
                    </div>
                    ${r.finalist_email_sent ? '<div style="color:#2E7D32;font-size:11px;font-weight:700;">✓ Sent</div>' : '<div></div>'}
                </div>`).join('');

        const noEmailWarn = m.without_email && m.without_email.length > 0
            ? `<div class="ep-warning">
                ⚠ <strong>${m.without_email.length}</strong> finalist${m.without_email.length !== 1 ? 's' : ''}
                without an email address will be skipped:
                ${m.without_email.map(f => frappe.utils.escape_html(f.name)).join(', ')}.
                Use <strong>Link Round 1</strong> on the main page to add emails before sending.
               </div>`
            : '';

        return `
        ${this.emailPanelStyles()}
        ${noEmailWarn}

        <div class="ep-cc-row" style="margin-bottom:14px;display:flex;align-items:center;gap:10px;">
            <label style="font-size:13px;font-weight:600;color:#555;white-space:nowrap;">CC (optional):</label>
            <input id="epCcInput" type="text" placeholder="email1@example.com, email2@example.com"
                style="flex:1;padding:6px 10px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;" />
            <span style="font-size:11px;color:#aaa;">Separate multiple addresses with commas</span>
        </div>

        <div class="ep-section">
            <div class="ep-section-header">
                <div>
                    <div class="ep-section-title">Finalist Notification Emails</div>
                    <div class="ep-section-sub">
                        Congratulations email to all finalists with a linked email address
                        &nbsp;·&nbsp; <strong>${m.with_email.length}</strong> recipient${m.with_email.length !== 1 ? 's' : ''}
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:10px;">
                    ${sentBadge(m.finalist_emails_sent)}
                    <button class="ep-send-btn" id="btnSendFinalist" ${m.with_email.length === 0 ? 'disabled' : ''}>
                        ${m.finalist_emails_sent ? '↺ Re-send' : '⬆ Send'}
                    </button>
                </div>
            </div>
            <div class="ep-list">${recipientRows(m.with_email, true)}</div>
        </div>

        <div class="ep-section">
            <div class="ep-section-header">
                <div>
                    <div class="ep-section-title">Regret Emails (Non-Finalists)</div>
                    <div class="ep-section-sub">
                        Sent to Round 2 respondents NOT selected as finalists — emails looked up via Round 1 records
                        &nbsp;·&nbsp; <strong>${m.regret.length}</strong> respondent${m.regret.length !== 1 ? 's' : ''}
                        (${m.regret.filter(r => r.has_email).length} with email found)
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:10px;">
                    ${sentBadge(m.finalist_regret_emails_sent)}
                    <button class="ep-send-btn ep-send-btn-regret" id="btnSendRegret"
                            ${m.regret.filter(r => r.has_email).length === 0 ? 'disabled' : ''}>
                        ${m.finalist_regret_emails_sent ? '↺ Re-send' : '⬆ Send'}
                    </button>
                </div>
            </div>
            <div class="ep-list">${recipientRows(m.regret, true)}</div>
        </div>`;
    }

    wireEmailButtons(dial, m) {
        const getCC = () => (dial.body.querySelector('#epCcInput')?.value || '').trim();

        const doSend = (method, label, args, confirmMsg) => {
            frappe.confirm(confirmMsg, () => {
                frappe.call({
                    method,
                    args: { ...args, cc: getCC() },
                    freeze: true,
                    freeze_message: `Sending ${label}…`,
                    callback: (r) => {
                        dial.hide();
                        if (r.message && r.message.success) {
                            const msg = r.message.warning || r.message.message || `Sent ${r.message.sent} email(s).`;
                            frappe.show_alert({ message: msg, indicator: r.message.warning ? 'orange' : 'green' }, 8);
                            if (r.message.errors && r.message.errors.length) {
                                frappe.msgprint({
                                    title: `${label} — Errors`,
                                    message: r.message.errors.map(e => frappe.utils.escape_html(e)).join('<br>'),
                                    indicator: 'orange',
                                });
                            }
                        } else {
                            frappe.show_alert({ message: r.message?.error || 'Failed to send emails.', indicator: 'red' }, 8);
                        }
                    }
                });
            });
        };

        dial.body.querySelector('#btnSendFinalist')?.addEventListener('click', () => {
            doSend(
                'agri_judge.agri_judge.api.judging.send_r2_finalist_emails',
                'Finalist Notifications',
                {},
                `Send finalist congratulations emails to <strong>${m.with_email.length}</strong> finalist(s)?`
            );
        });

        dial.body.querySelector('#btnSendRegret')?.addEventListener('click', () => {
            const withEmail = m.regret.filter(r => r.has_email).length;
            if (m.finalist_regret_emails_sent) {
                frappe.confirm(
                    `⚠ <strong>Regret emails have already been sent.</strong><br><br>
                    Resending will deliver a duplicate to all <strong>${withEmail}</strong> non-finalist respondent(s).<br><br>
                    Are you absolutely sure you want to resend?`,
                    () => {
                        frappe.call({
                            method: 'agri_judge.agri_judge.api.judging.send_r2_finalist_regret_emails',
                            args: { force: 1, cc: getCC() },
                            freeze: true,
                            freeze_message: 'Sending Regret Emails…',
                            callback: (r) => {
                                dial.hide();
                                const msg = r.message?.warning || r.message?.message || `Sent ${r.message?.sent} email(s).`;
                                frappe.show_alert({ message: msg, indicator: r.message?.warning ? 'orange' : 'green' }, 8);
                            }
                        });
                    }
                );
            } else {
                doSend(
                    'agri_judge.agri_judge.api.judging.send_r2_finalist_regret_emails',
                    'Regret Emails',
                    {},
                    `Send regret emails to <strong>${withEmail}</strong> non-finalist respondent(s)?`
                );
            }
        });
    }

    exportCSV() {
        const lines = [['Applicant', 'County', 'R2 Avg Score', 'Email', 'R1 Application', 'Email Sent'].join(',')];
        this.data.forEach(f => {
            lines.push([
                `"${(f.applicant_name || '').replace(/"/g, '""')}"`,
                `"${(f.county || '').replace(/"/g, '""')}"`,
                f.avg_score > 0 ? f.avg_score.toFixed(2) : '',
                `"${(f.email || '').replace(/"/g, '""')}"`,
                `"${(f.r1_application || '').replace(/"/g, '""')}"`,
                f.finalist_email_sent ? 'Yes' : 'No',
            ].join(','));
        });
        const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = `round2_finalists_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
    }

    statCard(val, label, color) {
        return `
        <div class="stat-card" style="border-top-color:${color};">
            <div class="stat-num" style="color:${color};">${val}</div>
            <div class="stat-lbl">${label}</div>
        </div>`;
    }

    loadingHtml() {
        return `<div style="text-align:center;padding:100px 20px;color:#888;">
            <div style="font-size:40px;margin-bottom:16px;">⏳</div>
            <p>Loading Round 2 Finalists…</p>
        </div>`;
    }

    renderError(msg) {
        this.wrapper.html(`
            ${this.getStyles()}
            <div class="fin-wrap">
                <div style="text-align:center;padding:80px 20px;">
                    <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
                    <h3 style="color:#1565C0;">${frappe.utils.escape_html(msg)}</h3>
                    <button class="btn btn-primary" onclick="location.reload()">Retry</button>
                </div>
            </div>
        `);
    }

    _viewDialogStyles() {
        return `<style>
            .vd-wrap { font-family:Arial,sans-serif; max-width:680px; margin:0 auto; }
            .vd-chips { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:18px; }
            .vd-chip { background:#E3F2FD; color:#1565C0; border-radius:12px; padding:3px 12px; font-size:12px; font-weight:600; }
            .vd-chip-tech { background:#E8F5E9; color:#2E7D32; }
            .vd-section-head { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:#1565C0; margin-bottom:10px; margin-top:18px; padding-bottom:6px; border-bottom:2px solid #E3F2FD; }
            .vd-field { margin-bottom:14px; }
            .vd-label { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:#999; margin-bottom:4px; }
            .vd-value { font-size:13px; color:#333; line-height:1.7; }
            .vd-rich { font-size:13px; color:#333; line-height:1.75; }
            .vd-rich p { margin:0 0 6px; }
            .vd-attach { display:block; color:#1565C0; font-size:13px; text-decoration:none; margin-bottom:4px; }
            .vd-attach:hover { text-decoration:underline; }
            .js-table { font-size:12px; border:1px solid #e8e8e8; border-radius:8px; overflow:hidden; margin-bottom:14px; }
            .js-head { display:grid; grid-template-columns:1fr 70px 70px 70px 70px; background:#1a1a1a; color:white; padding:7px 10px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; gap:4px; }
            .js-row { display:grid; grid-template-columns:1fr 70px 70px 70px 70px; padding:8px 10px; border-top:1px solid #f0f0f0; align-items:center; gap:4px; }
            .js-row:hover { background:#fafafa; }
            .js-judge { font-size:12px; font-weight:600; color:#333; }
            .js-val { font-size:12px; color:#555; }
            .js-total { font-size:13px; font-weight:800; }
            .js-pass { color:#2E7D32; }
            .js-fail { color:#E65100; }
            .js-avg-row { display:grid; grid-template-columns:1fr 70px 70px 70px 70px; padding:7px 10px; background:#F3E5F5; border-top:2px solid #CE93D8; gap:4px; font-size:11px; font-weight:700; color:#6A1B9A; }
            .js-avg { font-size:14px; font-weight:900; color:#6A1B9A; }
            .r2-link-input { width:100%; padding:7px 12px; border:1px solid #d0d0d0; border-radius:7px; font-size:13px; font-family:inherit; box-sizing:border-box; }
            .r2-link-input:focus { outline:none; border-color:#1565C0; }
            .r2l-list { max-height:220px; overflow-y:auto; border:1px solid #e8e8e8; border-radius:8px; margin-top:4px; }
            .r2l-row { display:flex; justify-content:space-between; align-items:center; padding:8px 12px; border-bottom:1px solid #f0f0f0; gap:10px; }
            .r2l-row:last-child { border-bottom:none; }
            .r2l-row:hover { background:#fafafa; }
            .r2l-info { min-width:0; }
            .r2l-name { font-size:13px; font-weight:700; color:#1a1a1a; }
            .r2l-sub { font-size:11px; color:#aaa; margin-top:2px; }
            .r2l-btn { background:#E8F5E9; color:#2E7D32; border:1px solid #A5D6A7; padding:4px 14px; border-radius:7px; font-size:12px; font-weight:700; cursor:pointer; white-space:nowrap; font-family:inherit; flex-shrink:0; }
            .r2l-btn:hover:not(:disabled) { background:#C8E6C9; }
            .r2l-btn:disabled { opacity:.5; cursor:not-allowed; }
        </style>`;
    }

    emailPanelStyles() {
        return `<style>
            .ep-warning { background:#FFF8E1; border:1px solid #FFE082; border-radius:8px; padding:10px 14px; font-size:13px; color:#E65100; margin-bottom:14px; }
            .ep-section { border:1px solid #e0e0e0; border-radius:10px; margin-bottom:14px; overflow:hidden; }
            .ep-section-header { display:flex; justify-content:space-between; align-items:center; padding:12px 16px; background:#f9f9f9; border-bottom:1px solid #e0e0e0; gap:10px; flex-wrap:wrap; }
            .ep-section-title { font-size:14px; font-weight:800; color:#1a1a1a; }
            .ep-section-sub { font-size:12px; color:#888; margin-top:2px; }
            .ep-list { max-height:200px; overflow-y:auto; }
            .ep-row { display:grid; grid-template-columns:1fr auto auto; gap:10px; padding:8px 16px; border-bottom:1px solid #f5f5f5; align-items:center; }
            .ep-row:last-child { border-bottom:none; }
            .ep-send-btn { background:#1565C0; color:white; border:none; padding:6px 16px; border-radius:7px; font-size:12px; font-weight:700; cursor:pointer; font-family:inherit; white-space:nowrap; }
            .ep-send-btn:hover:not(:disabled) { background:#0D47A1; }
            .ep-send-btn:disabled { opacity:.4; cursor:not-allowed; }
            .ep-send-btn-regret { background:#C62828; }
            .ep-send-btn-regret:hover:not(:disabled) { background:#B71C1C; }
            .email-sent-badge { background:#E8F5E9; color:#2E7D32; padding:3px 9px; border-radius:12px; font-size:11px; font-weight:700; }
            .email-pending-badge { background:#F5F5F5; color:#999; padding:3px 9px; border-radius:12px; font-size:11px; font-weight:700; }
        </style>`;
    }

    getFooter() {
        return `
        <footer class="krc-footer">
            <div class="krc-footer-inner">
                <div class="krc-footer-brand">
                    <span class="krc-footer-cross">✚</span>
                    <span class="krc-footer-text">Built by <strong>Kenya Red Cross — Digital Transformation Unit</strong></span>
                </div>
                <div class="krc-footer-partners">
                    In partnership with <strong>IOMe</strong> &amp; <strong>Airbus</strong>
                    &nbsp;·&nbsp; AgriWaste Innovation Challenge ${new Date().getFullYear()}
                </div>
            </div>
        </footer>`;
    }

    getStyles() {
        return `<style>
            .fin-wrap { max-width:1100px; margin:0 auto; padding-bottom:0; min-height:calc(100vh - 60px); display:flex; flex-direction:column; font-family:Arial,sans-serif; }

            .fin-header { background:linear-gradient(135deg,#1565C0 0%,#0D47A1 100%); padding:24px 28px; border-radius:10px; margin-bottom:20px; color:white; }
            .fin-header-inner { display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; }
            .fin-header h1 { margin:0 0 6px; font-size:24px; font-weight:700; }
            .fin-subtitle { margin:0; font-size:13px; opacity:.8; }
            .view-badge { padding:5px 14px; border-radius:20px; font-size:12px; font-weight:700; background:rgba(255,255,255,.2); color:white; }
            .btn-export { background:white; color:#1565C0; border:none; padding:7px 16px; border-radius:7px; font-size:13px; font-weight:700; cursor:pointer; transition:all .15s; }
            .btn-export:hover { background:#f8f8f8; transform:scale(1.04); }

            .fin-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:14px; margin-bottom:20px; }
            .stat-card { background:white; border-radius:10px; padding:18px 20px; box-shadow:0 2px 8px rgba(0,0,0,.06); border-top:4px solid #1565C0; }
            .stat-num { font-size:30px; font-weight:800; line-height:1; margin-bottom:4px; }
            .stat-lbl { font-size:11px; color:#999; text-transform:uppercase; letter-spacing:.5px; font-weight:600; }

            .fin-warning { background:#FFF8E1; border:1px solid #FFE082; border-radius:8px; padding:10px 16px; font-size:13px; color:#E65100; margin-bottom:18px; }

            .btn-add-more { background:#E3F2FD; color:#1565C0; border:1px solid #BBDEFB; padding:8px 18px; border-radius:7px; font-size:13px; font-weight:700; cursor:pointer; transition:all .15s; font-family:inherit; }
            .btn-add-more:hover { background:#BBDEFB; }

            .add-panel { background:white; border:1px solid #e0e0e0; border-radius:10px; margin-bottom:20px; box-shadow:0 2px 8px rgba(0,0,0,.06); overflow:hidden; }
            .add-panel-header { display:flex; justify-content:space-between; align-items:center; padding:12px 18px; background:#f5f5f5; border-bottom:1px solid #e0e0e0; font-size:14px; }
            .add-panel-close { background:none; border:none; font-size:16px; cursor:pointer; color:#888; line-height:1; padding:2px 6px; border-radius:4px; }
            .add-panel-close:hover { background:#e0e0e0; }
            .add-table-head { display:grid; grid-template-columns:1fr 100px 140px 210px; padding:9px 16px; background:#1a1a1a; color:white; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; gap:8px; }
            .add-row { display:grid; grid-template-columns:1fr 100px 140px 210px; padding:11px 16px; border-bottom:1px solid #f5f5f5; align-items:center; gap:8px; }
            .add-row:last-child { border-bottom:none; }
            .add-row:hover { background:#fafafa; }

            .fin-county-card { background:white; border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,.06); margin-bottom:18px; overflow:hidden; }
            .fin-county-header { padding:14px 20px 12px; border-left:5px solid #1565C0; display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
            .fin-county-title { font-size:17px; font-weight:800; display:flex; align-items:center; gap:8px; }
            .county-dot { width:12px; height:12px; border-radius:50%; flex-shrink:0; }
            .fin-county-count { font-size:12px; color:#999; }

            .fin-table { }
            .fin-table-head { display:grid; grid-template-columns:1fr 100px 1fr 100px 150px; padding:9px 18px; background:#1a1a1a; color:white; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; gap:8px; }
            .fin-table-row { display:grid; grid-template-columns:1fr 100px 1fr 100px 150px; padding:12px 18px; border-bottom:1px solid #f5f5f5; align-items:center; gap:8px; }
            .fin-table-row:last-child { border-bottom:none; }
            .fin-table-row:hover { background:#fafafa; }

            .app-name-cell { display:flex; flex-direction:column; }
            .app-name { font-size:14px; font-weight:700; color:#1a1a1a; }
            .app-sub  { font-size:11px; color:#aaa; margin-top:1px; }

            .score-cell { font-size:15px; font-weight:800; }
            .score-green   { color:#2E7D32; }
            .score-orange  { color:#E65100; }
            .score-neutral { color:#888; }

            .email-cell { font-size:12px; display:flex; align-items:center; gap:6px; min-width:0; }
            .has-email { color:#2E7D32; }
            .no-email  { color:#E65100; }
            .email-icon { font-size:14px; flex-shrink:0; }
            .email-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

            .badge { padding:3px 9px; border-radius:12px; font-size:11px; font-weight:700; white-space:nowrap; }
            .badge-sent    { background:#E8F5E9; color:#2E7D32; }
            .badge-pending { background:#F5F5F5; color:#999; }
            .badge-pass    { background:#E8F5E9; color:#2E7D32; }
            .badge-fail    { background:#FFF3E0; color:#E65100; }
            .badge-neutral { background:#F5F5F5; color:#888; }

            .btn-remove { background:#FFEBEE; color:#C62828; border:1px solid #FFCDD2; padding:4px 12px; border-radius:7px; font-size:12px; font-weight:700; cursor:pointer; transition:all .15s; font-family:inherit; }
            .btn-remove:hover { background:#FFCDD2; }
            .btn-view-app, .btn-view-preview { background:#F3E5F5; color:#6A1B9A; border:1px solid #CE93D8; padding:4px 10px; border-radius:7px; font-size:12px; font-weight:700; cursor:pointer; transition:all .15s; font-family:inherit; white-space:nowrap; }
            .btn-view-app:hover, .btn-view-preview:hover { background:#CE93D8; }
            .btn-select { background:#E3F2FD; color:#1565C0; border:1px solid #BBDEFB; padding:5px 12px; border-radius:7px; font-size:12px; font-weight:700; cursor:pointer; transition:all .15s; font-family:inherit; }
            .btn-select:hover { background:#BBDEFB; }
            .btn-select:disabled { opacity:.5; cursor:not-allowed; }

            .fin-empty { padding:70px 30px; text-align:center; color:#aaa; font-size:15px; }
            .fin-empty p { font-size:13px; margin-top:8px; }

            .krc-footer { margin-top:32px; border-top:2px solid #f0f0f0; padding:16px 0 22px; }
            .krc-footer-inner { display:flex; flex-direction:column; align-items:center; gap:5px; text-align:center; }
            .krc-footer-brand { display:flex; align-items:center; gap:10px; font-size:13px; color:#555; }
            .krc-footer-cross { font-size:20px; color:#ED1B2E; font-weight:900; line-height:1; }
            .krc-footer-text strong { color:#ED1B2E; }
            .krc-footer-partners { font-size:12px; color:#aaa; }
            .krc-footer-partners strong { color:#777; }
        </style>`;
    }
}
