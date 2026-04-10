/**
 * Round 2 Judge Review
 * Accessible by Judges and Coordinators.
 * Route: /app/round-2-judge-review/{r2_applicant_name}
 *
 * Shows:
 *  - Original application data
 *  - Round 2 Response (if submitted)
 *  - 7-criterion scoring form (criteria 1-6 scored 0-5, tech bonus 0-3)
 *  - Leverage info (read-only, set by coordinator)
 *  - Live score calculation
 */

frappe.pages['round-2-judge-review'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Round 2 — Review & Score',
        single_column: true,
    });
    const isCoordinator = frappe.user.has_role('Coordinator');
    page.set_secondary_action('← Back', () =>
        frappe.set_route(isCoordinator ? 'round-2-scoring-dashboard' : 'judge-dashboard')
    );
    wrapper._r2review = new R2JudgeReview(page, isCoordinator);
};

frappe.pages['round-2-judge-review'].on_page_show = function (wrapper) {
    if (wrapper._r2review) {
        const r2id = frappe.get_route()[1];
        if (r2id) wrapper._r2review.load(r2id);
        else frappe.set_route(frappe.user.has_role('Coordinator') ? 'round-2-scoring-dashboard' : 'judge-dashboard');
    }
};

class R2JudgeReview {
    constructor(page, isCoordinator) {
        this.page          = page;
        this.wrapper       = $(this.page.body);
        this.rubric        = null;
        this.appData       = null;
        this.scores        = {};   // criterion_id → {score, notes}
        this.techScore     = 0;
        this.r2id          = null;
        this.isCoordinator = !!isCoordinator;
    }

    load(r2id) {
        this.r2id = r2id;
        this.wrapper.html(this.loadingHtml());

        // Load rubric and application data in parallel
        Promise.all([
            this.fetchRubric(),
            this.fetchApplication(r2id),
        ]).then(([rubric, appData]) => {
            this.rubric  = rubric;
            this.appData = appData;
            this.render();
        }).catch(err => {
            this.renderError('Failed to load data: ' + err.message);
        });
    }

    fetchRubric() {
        return new Promise((resolve, reject) => {
            frappe.call({
                method: 'agri_judge.agri_judge.api.judging.get_r2_criteria_definitions',
                callback: r => {
                    if (r.message && r.message.success) resolve(r.message);
                    else reject(new Error(r.message?.error || 'Rubric fetch failed'));
                }
            });
        });
    }

    fetchApplication(r2id) {
        return new Promise((resolve, reject) => {
            frappe.call({
                method: 'agri_judge.agri_judge.api.judging.get_application_for_r2_review',
                args: { r2_applicant_name: r2id },
                callback: r => {
                    if (r.message && r.message.success) resolve(r.message);
                    else reject(new Error(r.message?.error || 'Application fetch failed'));
                }
            });
        });
    }

    render() {
        const d   = this.appData;
        const app = d.application;
        const r2  = d.r2_applicant;
        const resp = d.r2_response;

        // Pre-populate scores from existing evaluation
        if (d.evaluation) {
            (d.evaluation.criteria || []).forEach(c => {
                this.scores[c.criterion_id] = { score: c.score, notes: c.notes || '' };
            });
            this.techScore = parseInt(d.evaluation.tech_score || 0);
        }

        const readOnly = d.read_only;

        this.wrapper.html(`
            ${this.getStyles()}
            <div class="r2r-wrap">

                ${this.renderHeader(app, r2, readOnly)}
                ${this.renderAppDetails(app, resp)}
                ${readOnly ? this.renderReadOnlyScores(d.evaluation, d.peer_evaluations) : this.renderScoringForm(d)}
                ${!readOnly ? this.renderSubmitSection() : ''}

            </div>
        `);

        if (!readOnly) {
            this.bindEvents();
            this.recalcLive();
        }

        // expose to inline handlers
        window.R2R = this;
    }

    renderHeader(app, r2, readOnly) {
        const coordinatorBadge = this.isCoordinator
            ? `<span class="r2r-badge" style="background:#1565C0;color:white;">Coordinator</span>`
            : '';
        const leverageLabel = r2.leverage_category && r2.leverage_category !== 'None'
            ? `<span class="r2r-badge badge-leverage">🏅 ${frappe.utils.escape_html(r2.leverage_category)}</span>`
            : '';
        const statusBadge = r2.score_status
            ? `<span class="r2r-badge badge-status">${frappe.utils.escape_html(r2.score_status)}</span>`
            : '';
        const readOnlyBanner = readOnly
            ? `<div class="r2r-readonly-banner">✅ You have already submitted your evaluation for this applicant. Scores are locked.</div>`
            : '';
        return `
        <div class="r2r-header">
            <div class="r2r-header-inner">
                <div>
                    <h1>${frappe.utils.escape_html(app.full_name || 'Applicant')}</h1>
                    <div class="r2r-header-meta">
                        ${frappe.utils.escape_html(app.county_of_residence || '')}
                        ${app.gender ? ' · ' + frappe.utils.escape_html(app.gender) : ''}
                        ${app.age_group ? ' · Age: ' + frappe.utils.escape_html(app.age_group) : ''}
                    </div>
                    <div class="r2r-badges">
                        ${coordinatorBadge}
                        ${statusBadge}
                        ${leverageLabel}
                        ${r2.leverage_category && r2.leverage_category !== 'None'
                            ? `<span class="r2r-badge badge-pts">+${this.leveragePts(r2.leverage_category)} pts (if score ≥40)</span>`
                            : ''}
                    </div>
                </div>
                <div class="r2r-r1-box">
                    <div class="r2r-r1-label">Round 1 Avg</div>
                    <div class="r2r-r1-score">${r2.avg_score || '—'}</div>
                    <div class="r2r-r1-label">/ 10</div>
                </div>
            </div>
            ${readOnlyBanner}
        </div>`;
    }

    leveragePts(cat) {
        return { 'Top Shortlisted': 10, 'Above Threshold': 5, 'At Threshold': 2 }[cat] || 0;
    }

    renderAppDetails(app, resp) {
        const fields = [
            { label: 'Project Level',           value: app.level_of_project },
            { label: 'Describe Your Idea',       value: app.describe_your_idea },
            { label: 'Proposed Product',         value: app.proposed_product },
            { label: 'Production Process',       value: app.production_process },
            { label: 'Environmental Contributions', value: app.enviromental_contributions },
            { label: 'Innovativeness',           value: app.demonstrate_innovativeness },
            { label: 'Enterprise Benefits',      value: app.enterprise_benefits },
            { label: 'Prior Experience',         value: app.prior_experience },
            { label: 'Next Step Skills',         value: app.next_step_skills },
            { label: 'Incubator Programs',       value: app.incubator_programs },
            { label: 'Use of Micro-Grant',       value: app.use_of_micro_grant },
        ].filter(f => f.value);

        const r2Section = resp ? `
            <div class="r2r-section r2r-section-highlight">
                <h3 class="r2r-section-title">📋 Round 2 Submission</h3>
                ${resp.developmental_level
                    ? `<div class="r2r-field"><span class="r2r-field-label">Development Level</span><p>${frappe.utils.escape_html(resp.developmental_level)}</p></div>`
                    : ''}
                ${resp.is_tech_enabled
                    ? `<div class="r2r-tech-pill">⚡ Tech-Enabled Project</div>`
                    : ''}
                ${resp.innovation_description
                    ? `<div class="r2r-field"><span class="r2r-field-label">Innovation Description</span><div class="r2r-prose">${resp.innovation_description}</div></div>`
                    : ''}
                ${resp.resources_needed
                    ? `<div class="r2r-field"><span class="r2r-field-label">Resources Needed</span><div class="r2r-prose">${resp.resources_needed}</div></div>`
                    : ''}
                ${resp.financial_records
                    ? `<div class="r2r-field"><span class="r2r-field-label">Financial Records</span><a href="${frappe.utils.escape_html(resp.financial_records)}" target="_blank" class="r2r-link">📎 View Financial Records</a></div>`
                    : '<div class="r2r-warning">⚠️ No financial records submitted.</div>'}
            </div>` : `
            <div class="r2r-section r2r-no-response">
                <p>⚠️ This applicant has not submitted a Round 2 Response form yet. Score based on original application only.</p>
            </div>`;

        return `
        <div class="r2r-section">
            <h3 class="r2r-section-title">📄 Original Application</h3>
            ${fields.map(f => `
                <div class="r2r-field">
                    <span class="r2r-field-label">${frappe.utils.escape_html(f.label)}</span>
                    <p>${frappe.utils.escape_html(f.value)}</p>
                </div>`).join('')}
        </div>
        ${r2Section}`;
    }

    renderScoringForm(d) {
        const r2   = d.r2_applicant;
        const resp = d.r2_response;
        const isTechEnabled = resp && resp.is_tech_enabled;

        const criteriaHtml = (this.rubric.criteria || []).map((c, idx) => {
            const existing = this.scores[c.id] || {};
            const bandsHtml = c.bands.map(b => `
                <div class="r2r-band">
                    <span class="r2r-band-score">${b.score}</span>
                    <span class="r2r-band-text">${frappe.utils.escape_html(b.text)}</span>
                </div>`).join('');

            const noteText = c.note ? `<div class="r2r-criterion-note">⚠️ ${frappe.utils.escape_html(c.note)}</div>` : '';
            return `
            <div class="r2r-criterion" id="crit-${c.id}">
                <div class="r2r-criterion-header">
                    <div class="r2r-criterion-title">
                        <span class="r2r-crit-num">${idx + 1}</span>
                        ${frappe.utils.escape_html(c.name)}
                    </div>
                    <span class="r2r-crit-max">Max: ${c.max_points} pts</span>
                </div>
                <p class="r2r-criterion-desc">${frappe.utils.escape_html(c.desc)}</p>
                ${noteText}
                <div class="r2r-bands">${bandsHtml}</div>
                <div class="r2r-score-row">
                    <label class="r2r-score-label">Score (0–5):</label>
                    <div class="r2r-score-btns" id="btns-${c.id}">
                        ${[0,1,2,3,4,5].map(v => `
                            <button type="button"
                                class="r2r-score-btn${existing.score === v ? ' active' : ''}"
                                onclick="window.R2R.setScore('${c.id}', ${v})">${v}
                            </button>`).join('')}
                    </div>
                    <span class="r2r-pts-display" id="pts-${c.id}">${
                        existing.score !== undefined
                            ? existing.score * c.multiplier + ' pts'
                            : '—'
                    }</span>
                </div>
                <div class="r2r-guiding">💡 ${frappe.utils.escape_html(c.guiding)}</div>
                <textarea class="r2r-notes" id="notes-${c.id}"
                    placeholder="Notes for this criterion (optional)"
                    oninput="window.R2R.setNotes('${c.id}', this.value)">${frappe.utils.escape_html(existing.notes || '')}</textarea>
            </div>`;
        }).join('');

        const techBands = (this.rubric.tech.bands || []).map(b => `
            <div class="r2r-band">
                <span class="r2r-band-score">${b.score}</span>
                <span class="r2r-band-text">${frappe.utils.escape_html(b.text)}</span>
            </div>`).join('');

        const leverageRows = (this.rubric.leverage.table || []).map(l => `
            <tr>
                <td>${frappe.utils.escape_html(l.category)}</td>
                <td class="r2r-pts-col">+${l.points} pts</td>
            </tr>`).join('');

        return `
        <div class="r2r-section r2r-scoring">
            <h3 class="r2r-section-title">⚖️ Scoring Rubric</h3>
            <p class="r2r-scoring-hint">Score each criterion 0–5. Points = score × multiplier. Subtotal out of 100.</p>

            ${criteriaHtml}

            <!-- Criterion 7: Tech Bonus -->
            <div class="r2r-criterion r2r-tech-crit">
                <div class="r2r-criterion-header">
                    <div class="r2r-criterion-title">
                        <span class="r2r-crit-num">7</span>
                        Tech Enablement (Bonus)
                        ${isTechEnabled ? '<span class="r2r-tech-flag">⚡ Applicant flagged as tech-enabled</span>' : ''}
                    </div>
                    <span class="r2r-crit-max">Max: +5 bonus pts</span>
                </div>
                <p class="r2r-criterion-desc">${frappe.utils.escape_html(this.rubric.tech.desc)}</p>
                <div class="r2r-bands">${techBands}</div>
                <div class="r2r-score-row">
                    <label class="r2r-score-label">Tech Score (0–3):</label>
                    <div class="r2r-score-btns" id="btns-tech">
                        ${[0,1,2,3].map(v => `
                            <button type="button"
                                class="r2r-score-btn${this.techScore === v ? ' active' : ''}"
                                onclick="window.R2R.setTech(${v})">${v}
                            </button>`).join('')}
                    </div>
                    <span class="r2r-pts-display" id="pts-tech">${this.techBonusPts(this.techScore)} pts</span>
                </div>
            </div>

            <!-- Leverage info -->
            <div class="r2r-leverage-box">
                <h4>🏅 Leverage Points (applied automatically)</h4>
                <p style="font-size:12px;color:#666;margin-bottom:8px">
                    Leverage points are added automatically based on coordinator-set category.
                    Only applied when subtotal ≥ 40.
                </p>
                <table class="r2r-leverage-table">
                    <thead><tr><th>Category</th><th>Bonus</th></tr></thead>
                    <tbody>${leverageRows}</tbody>
                </table>
                <div class="r2r-leverage-current">
                    This applicant: <strong>${frappe.utils.escape_html(r2.leverage_category || 'None')}</strong>
                    ${r2.leverage_category && r2.leverage_category !== 'None'
                        ? ` → <span style="color:#2E7D32">+${this.leveragePts(r2.leverage_category)} pts (if subtotal ≥ 40)</span>`
                        : ''}
                </div>
            </div>

            <!-- Live total -->
            <div class="r2r-live-total">
                <div class="r2r-live-row">
                    <span>Subtotal (Criteria 1–6):</span>
                    <span id="live-subtotal">—</span>
                </div>
                <div class="r2r-live-row">
                    <span>Tech Bonus:</span>
                    <span id="live-tech">—</span>
                </div>
                <div class="r2r-live-row">
                    <span>Leverage Points:</span>
                    <span id="live-leverage">—</span>
                </div>
                <div class="r2r-live-row r2r-live-total-row">
                    <span>TOTAL SCORE:</span>
                    <span id="live-total">—</span>
                </div>
                <div id="live-cutoff-msg" style="margin-top:8px;text-align:center;font-size:13px;"></div>
            </div>

            <div class="r2r-notes-section">
                <label class="r2r-score-label">Overall Recommendation Notes (optional):</label>
                <textarea id="overall-notes" rows="3" class="r2r-notes"
                    placeholder="Any overall comments or recommendation…"></textarea>
            </div>
        </div>`;
    }

    renderSubmitSection() {
        return `
        <div class="r2r-submit-wrap">
            <div class="r2r-submit-warning" id="submit-warning" style="display:none"></div>
            <button class="r2r-submit-btn" id="submit-btn" onclick="window.R2R.submit()">
                Submit Evaluation
            </button>
            <p class="r2r-submit-hint">Once submitted, your scores cannot be changed.</p>
        </div>`;
    }

    renderReadOnlyScores(evaluation, peerEvals) {
        if (!evaluation) return '';
        const r2  = this.appData.r2_applicant;
        const critHtml = (this.rubric.criteria || []).map((c, idx) => {
            const row = (evaluation.criteria || []).find(x => x.criterion_id === c.id) || {};
            return `
            <div class="r2r-ro-crit">
                <div class="r2r-ro-crit-name">${idx + 1}. ${frappe.utils.escape_html(c.name)}</div>
                <div class="r2r-ro-crit-score">
                    Score: <strong>${row.score ?? '—'}</strong>/5
                    → <strong>${row.points_earned ?? '—'}</strong>/${c.max_points} pts
                </div>
                ${row.notes ? `<div class="r2r-ro-notes">${frappe.utils.escape_html(row.notes)}</div>` : ''}
            </div>`;
        }).join('');

        const peerHtml = (peerEvals || []).filter(p => !p.is_own).map(p => `
            <div class="r2r-peer-card">
                <div class="r2r-peer-name">${frappe.utils.escape_html(p.judge_name)}</div>
                <div class="r2r-peer-scores">
                    Subtotal: <strong>${p.subtotal_score}</strong>
                    + Tech: <strong>${p.tech_bonus}</strong>
                    + Leverage: <strong>${p.leverage_points}</strong>
                    = <strong class="${p.passes_cutoff ? 'color-pass' : 'color-fail'}">${p.total_score}</strong>
                    ${p.passes_cutoff ? '✅' : '❌'}
                </div>
            </div>`).join('');

        const tech = parseInt(evaluation.tech_score || 0);
        return `
        <div class="r2r-section r2r-readonly">
            <h3 class="r2r-section-title">✅ Your Submitted Scores</h3>
            ${critHtml}
            <div class="r2r-ro-crit">
                <div class="r2r-ro-crit-name">7. Tech Enablement (Bonus)</div>
                <div class="r2r-ro-crit-score">
                    Score: <strong>${tech}</strong>/3 → <strong>${this.techBonusPts(tech)}</strong> bonus pts
                </div>
            </div>
            <div class="r2r-totals-box">
                <div>Subtotal: <strong>${evaluation.subtotal_score}</strong> / 100</div>
                <div>Tech Bonus: <strong>+${evaluation.tech_bonus_points}</strong></div>
                <div>Leverage (${frappe.utils.escape_html(evaluation.leverage_category || 'None')}): <strong>+${evaluation.leverage_points}</strong></div>
                <div class="r2r-total-line">TOTAL: <strong class="${evaluation.passes_cutoff ? 'color-pass' : 'color-fail'}">${evaluation.total_score}</strong> / 110
                    ${evaluation.passes_cutoff ? '✅ Above cut-off (60)' : '❌ Below cut-off (60)'}
                </div>
            </div>
            ${evaluation.overall_notes
                ? `<div class="r2r-ro-notes"><strong>Notes:</strong> ${frappe.utils.escape_html(evaluation.overall_notes)}</div>`
                : ''}
        </div>
        ${peerEvals && peerEvals.filter(p => !p.is_own).length > 0 ? `
        <div class="r2r-section">
            <h3 class="r2r-section-title">👥 Peer Evaluations</h3>
            ${peerHtml}
        </div>` : ''}`;
    }

    // ── Interactivity ──

    setScore(criterionId, value) {
        if (!this.scores[criterionId]) this.scores[criterionId] = {};
        this.scores[criterionId].score = value;

        // Update button states
        $(`#btns-${criterionId} .r2r-score-btn`).removeClass('active');
        $(`#btns-${criterionId} .r2r-score-btn:eq(${value})`).addClass('active');

        // Update pts display
        const c = (this.rubric.criteria || []).find(x => x.id === criterionId);
        if (c) $(`#pts-${criterionId}`).text(value * c.multiplier + ' pts');

        this.recalcLive();
    }

    setNotes(criterionId, value) {
        if (!this.scores[criterionId]) this.scores[criterionId] = {};
        this.scores[criterionId].notes = value;
    }

    setTech(value) {
        this.techScore = value;
        $('#btns-tech .r2r-score-btn').removeClass('active');
        $(`#btns-tech .r2r-score-btn:eq(${value})`).addClass('active');
        $('#pts-tech').text(this.techBonusPts(value) + ' pts');
        this.recalcLive();
    }

    techBonusPts(score) {
        return [0, 2, 3, 5][parseInt(score || 0)] ?? 0;
    }

    recalcLive() {
        const rubric = this.rubric;
        if (!rubric) return;

        let subtotal = 0;
        (rubric.criteria || []).forEach(c => {
            const s = this.scores[c.id];
            if (s && s.score !== undefined) {
                subtotal += s.score * c.multiplier;
            }
        });

        const techBonus = this.techBonusPts(this.techScore);
        const r2data    = this.appData.r2_applicant;
        const levCat    = r2data.leverage_category || 'None';
        let leverage    = 0;

        if (subtotal >= 40) {
            leverage += { 'Top Shortlisted': 10, 'Above Threshold': 5, 'At Threshold': 2, 'None': 0 }[levCat] || 0;
            // Female applicant auto-bonus comes from server-side during submit
        }

        const total = subtotal + techBonus + leverage;

        $('#live-subtotal').text(subtotal + ' / 100');
        $('#live-tech').text('+' + techBonus + ' pts');
        $('#live-leverage').text('+' + leverage + ' pts');
        $('#live-total').text(total + ' / 110').css('color', total >= 60 ? '#2E7D32' : '#C62828');

        const msg = $('#live-cutoff-msg');
        if (total >= 60) msg.html('<span style="color:#2E7D32">✅ Above cut-off (60 pts)</span>');
        else msg.html('<span style="color:#C62828">❌ Below cut-off (60 pts)</span>');
    }

    bindEvents() {
        // Nothing extra — all via inline onclick/oninput
    }

    submit() {
        const rubric = this.rubric;
        // Validate all 6 criteria scored
        const missing = (rubric.criteria || []).filter(c => {
            const s = this.scores[c.id];
            return s === undefined || s.score === undefined;
        });
        if (missing.length > 0) {
            $('#submit-warning')
                .text('Please score all 6 criteria before submitting.')
                .show();
            return;
        }
        $('#submit-warning').hide();

        const criteriaPayload = {};
        (rubric.criteria || []).forEach(c => {
            criteriaPayload[c.id] = {
                score: this.scores[c.id].score,
                notes: (this.scores[c.id].notes || ''),
            };
        });

        const btn = $('#submit-btn');
        btn.prop('disabled', true).text('Submitting…');

        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.submit_r2_evaluation',
            args: {
                r2_applicant_name: this.r2id,
                criteria_scores:   JSON.stringify(criteriaPayload),
                tech_score:        this.techScore,
                overall_notes:     $('#overall-notes').val() || '',
            },
            callback: r => {
                btn.prop('disabled', false).text('Submit Evaluation');
                if (r.message && r.message.success) {
                    const msg = r.message;
                    frappe.msgprint({
                        title: '✅ Evaluation Submitted',
                        message: `
                            <b>Subtotal:</b> ${msg.subtotal_score} / 100<br>
                            <b>Tech Bonus:</b> +${msg.tech_bonus}<br>
                            <b>Leverage:</b> +${msg.leverage_points}<br>
                            <b>Total Score:</b> ${msg.total_score} / 110
                            ${msg.passes_cutoff ? '<br><b style="color:#2E7D32">✅ Above cut-off (60)</b>' : '<br><b style="color:#C62828">❌ Below cut-off (60)</b>'}
                        `,
                        indicator: msg.passes_cutoff ? 'green' : 'orange',
                    });
                    // Reload as read-only
                    setTimeout(() => this.load(this.r2id), 1500);
                } else {
                    frappe.msgprint({
                        title: 'Error',
                        message: r.message?.error || 'Submission failed.',
                        indicator: 'red',
                    });
                }
            }
        });
    }

    loadingHtml() {
        return `<div style="padding:60px;text-align:center;color:#888;"><div style="font-size:40px;margin-bottom:12px;">⏳</div><p>Loading…</p></div>`;
    }

    renderError(msg) {
        this.wrapper.html(`<div style="padding:60px;text-align:center;color:#C62828;"><div style="font-size:40px;margin-bottom:12px;">⚠️</div><p>${frappe.utils.escape_html(msg)}</p></div>`);
    }

    getStyles() {
        return `<style>
        .r2r-wrap{max-width:860px;margin:0 auto;padding:20px 16px 80px;font-family:var(--font-stack);}

        /* Header */
        .r2r-header{background:#fff;border:1px solid #e0e0e0;border-radius:10px;padding:20px 24px;margin-bottom:16px;}
        .r2r-header-inner{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;}
        .r2r-header h1{margin:0 0 4px;font-size:20px;font-weight:700;}
        .r2r-header-meta{font-size:13px;color:#666;margin-bottom:8px;}
        .r2r-badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;}
        .r2r-badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;}
        .badge-status{background:#E3F2FD;color:#1565C0;}
        .badge-leverage{background:#FFF8E1;color:#E65100;}
        .badge-pts{background:#E8F5E9;color:#2E7D32;}
        .r2r-r1-box{text-align:center;border:1px solid #e0e0e0;border-radius:8px;padding:10px 18px;min-width:90px;}
        .r2r-r1-label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;}
        .r2r-r1-score{font-size:28px;font-weight:700;color:#1565C0;line-height:1.2;}
        .r2r-readonly-banner{margin-top:12px;background:#E8F5E9;color:#2E7D32;padding:8px 12px;border-radius:6px;font-size:13px;font-weight:500;}

        /* Sections */
        .r2r-section{background:#fff;border:1px solid #e0e0e0;border-radius:10px;padding:20px 22px;margin-bottom:14px;}
        .r2r-section-highlight{border-left:4px solid #1565C0;}
        .r2r-section-title{margin:0 0 14px;font-size:15px;font-weight:700;color:#333;}
        .r2r-field{margin-bottom:12px;}
        .r2r-field-label{display:block;font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;}
        .r2r-field p{margin:0;font-size:13px;color:#333;line-height:1.5;}
        .r2r-prose{font-size:13px;color:#333;line-height:1.6;}
        .r2r-tech-pill{display:inline-block;background:#E3F2FD;color:#1565C0;border-radius:12px;padding:3px 12px;font-size:12px;font-weight:600;margin-bottom:10px;}
        .r2r-link{color:#1565C0;font-size:13px;text-decoration:none;}
        .r2r-link:hover{text-decoration:underline;}
        .r2r-warning{background:#FFF3E0;color:#E65100;padding:8px 12px;border-radius:6px;font-size:12px;}
        .r2r-no-response{background:#FFF3E0;border-color:#FFB74D;}
        .r2r-no-response p{color:#E65100;margin:0;font-size:13px;}

        /* Scoring */
        .r2r-scoring{}
        .r2r-scoring-hint{font-size:12px;color:#888;margin-bottom:16px;}
        .r2r-criterion{border:1px solid #e8e8e8;border-radius:8px;padding:16px 18px;margin-bottom:12px;}
        .r2r-tech-crit{border-color:#1565C0;background:#fafcff;}
        .r2r-criterion-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;}
        .r2r-criterion-title{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;}
        .r2r-crit-num{background:#1565C0;color:#fff;width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;}
        .r2r-crit-max{font-size:11px;color:#1565C0;font-weight:600;background:#E3F2FD;padding:2px 8px;border-radius:10px;}
        .r2r-criterion-desc{font-size:12px;color:#666;margin:6px 0 8px;line-height:1.5;}
        .r2r-criterion-note{background:#FFF3E0;color:#E65100;font-size:11px;padding:6px 10px;border-radius:4px;margin-bottom:8px;}
        .r2r-tech-flag{font-size:11px;background:#E3F2FD;color:#1565C0;padding:2px 8px;border-radius:10px;margin-left:8px;}
        .r2r-bands{border:1px solid #f0f0f0;border-radius:6px;overflow:hidden;margin-bottom:12px;}
        .r2r-band{display:flex;gap:10px;padding:6px 10px;border-bottom:1px solid #f0f0f0;font-size:12px;}
        .r2r-band:last-child{border-bottom:none;}
        .r2r-band:nth-child(even){background:#fafafa;}
        .r2r-band-score{font-weight:700;color:#1565C0;width:16px;flex-shrink:0;text-align:center;}
        .r2r-band-text{color:#444;line-height:1.4;}
        .r2r-score-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;}
        .r2r-score-label{font-size:12px;font-weight:600;color:#555;}
        .r2r-score-btns{display:flex;gap:4px;}
        .r2r-score-btn{width:36px;height:36px;border:2px solid #ddd;border-radius:6px;background:#fff;font-size:14px;font-weight:700;cursor:pointer;transition:all .15s;}
        .r2r-score-btn:hover{border-color:#1565C0;color:#1565C0;}
        .r2r-score-btn.active{background:#1565C0;border-color:#1565C0;color:#fff;}
        .r2r-pts-display{font-size:13px;color:#2E7D32;font-weight:600;min-width:55px;}
        .r2r-guiding{font-size:11px;color:#888;font-style:italic;margin-bottom:8px;}
        .r2r-notes{width:100%;border:1px solid #ddd;border-radius:6px;padding:8px 10px;font-size:12px;resize:vertical;font-family:var(--font-stack);box-sizing:border-box;}
        .r2r-notes:focus{outline:none;border-color:#1565C0;}

        /* Leverage */
        .r2r-leverage-box{background:#FFFDE7;border:1px solid #FDD835;border-radius:8px;padding:14px 16px;margin-bottom:14px;}
        .r2r-leverage-box h4{margin:0 0 8px;font-size:13px;}
        .r2r-leverage-table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px;}
        .r2r-leverage-table th,.r2r-leverage-table td{padding:5px 8px;text-align:left;border-bottom:1px solid #F9A825;}
        .r2r-pts-col{font-weight:700;color:#2E7D32;}
        .r2r-leverage-current{font-size:12px;}

        /* Live total */
        .r2r-live-total{background:#F8F9FA;border:2px solid #1565C0;border-radius:8px;padding:14px 18px;margin:14px 0;}
        .r2r-live-row{display:flex;justify-content:space-between;font-size:13px;padding:3px 0;color:#444;}
        .r2r-live-total-row{font-weight:700;font-size:16px;border-top:1px solid #ccc;margin-top:4px;padding-top:6px;color:#111;}

        /* Notes */
        .r2r-notes-section{margin-top:14px;}

        /* Submit */
        .r2r-submit-wrap{text-align:center;margin-top:20px;}
        .r2r-submit-btn{background:#1565C0;color:#fff;border:none;padding:12px 36px;font-size:16px;font-weight:700;border-radius:8px;cursor:pointer;transition:background .2s;}
        .r2r-submit-btn:hover{background:#0D47A1;}
        .r2r-submit-btn:disabled{background:#aaa;cursor:not-allowed;}
        .r2r-submit-hint{font-size:11px;color:#aaa;margin-top:8px;}
        .r2r-submit-warning{background:#FFEBEE;color:#C62828;padding:8px 14px;border-radius:6px;margin-bottom:10px;font-size:13px;}

        /* Read-only */
        .r2r-readonly{}
        .r2r-ro-crit{padding:10px 0;border-bottom:1px solid #f0f0f0;}
        .r2r-ro-crit:last-child{border-bottom:none;}
        .r2r-ro-crit-name{font-weight:600;font-size:13px;margin-bottom:3px;}
        .r2r-ro-crit-score{font-size:13px;color:#444;}
        .r2r-ro-notes{font-size:12px;color:#888;font-style:italic;margin-top:3px;}
        .r2r-totals-box{margin-top:14px;background:#f8f9fa;border-radius:8px;padding:12px 16px;font-size:13px;display:flex;flex-direction:column;gap:4px;}
        .r2r-total-line{font-weight:700;font-size:15px;margin-top:4px;border-top:1px solid #ddd;padding-top:6px;}
        .color-pass{color:#2E7D32;}
        .color-fail{color:#C62828;}
        .r2r-peer-card{background:#f5f5f5;border-radius:6px;padding:10px 14px;margin-bottom:8px;}
        .r2r-peer-name{font-weight:600;font-size:13px;margin-bottom:3px;}
        .r2r-peer-scores{font-size:12px;color:#444;}
        </style>`;
    }
}
