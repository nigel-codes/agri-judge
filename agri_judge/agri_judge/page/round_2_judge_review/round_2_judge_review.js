/**
 * Round 2 Judge Review v2
 * - Two-column layout: R2 content left, sticky scoring panel right (mirrors Round 1)
 * - Round 1 original application fields hidden — R2 response only
 * - Route: /app/round-2-judge-review/{r2_applicant_name}
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
        this.scores        = {};
        this.techScore     = 0;
        this.r2id          = null;
        this.isCoordinator = !!isCoordinator;
    }

    load(r2id) {
        this.r2id = r2id;
        this.wrapper.html(this.loadingHtml());

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
        const d        = this.appData;
        const app      = d.application;
        const r2       = d.r2_applicant;
        const resp     = d.r2_response;
        const readOnly = d.read_only;

        // Pre-populate scores from existing evaluation
        if (d.evaluation) {
            (d.evaluation.criteria || []).forEach(c => {
                this.scores[c.criterion_id] = { score: c.score, notes: c.notes || '' };
            });
            this.techScore = parseInt(d.evaluation.tech_score || 0);
        }

        // Store leverage context for live recalc
        // Leverage category is selected manually by the judge
        this.leverageCategory = (d.evaluation && d.evaluation.leverage_category) || 'None';
        // Default female bonus to true if gender is Female, but allow judge to override
        const genderIsFemale = resp && resp.gender && resp.gender.toLowerCase() === 'female';
        this.isFemale = d.evaluation
            ? !!d.evaluation.female_applicant
            : genderIsFemale;

        // Expose to inline handlers
        window.R2R = this;

        this.wrapper.html(`
            ${this.getStyles()}
            <div class="r2r-page">

                ${this.renderHeader(app, r2, readOnly)}

                <div class="r2r-body">

                    <!-- Left: R2 content -->
                    <div class="r2r-content">
                        ${this.renderR2Content(resp)}
                    </div>

                    <!-- Right: sticky scoring panel -->
                    <div class="r2r-sidebar">
                        ${readOnly
                            ? this.renderReadOnlySidebar(d.evaluation, d.peer_evaluations)
                            : this.renderScoringSidebar(d)
                        }
                    </div>

                </div>

            </div>
        `);

        if (!readOnly) {
            this.recalcLive();
        }
    }

    // ── Header (full-width) ──────────────────────────────────────────────────

    renderHeader(app, r2, readOnly) {
        const coordinatorBadge = this.isCoordinator
            ? `<span class="r2r-badge" style="background:#1565C0;color:white;">Coordinator</span>`
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
                    </div>
                </div>
            </div>
            ${readOnlyBanner}
        </div>`;
    }

    // ── Left panel: Round 2 response only ───────────────────────────────────

    renderR2Content(resp) {
        if (!resp) {
            return `
            <div class="r2r-section r2r-no-response">
                <p>⚠️ No Round 2 response data found for this applicant.</p>
            </div>`;
        }

        return `
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
        </div>`;
    }

    // ── Right panel: active scoring ─────────────────────────────────────────

    renderScoringSidebar(d) {
        const r2          = d.r2_applicant;
        const resp        = d.r2_response;
        const isTechEnabled = resp && resp.is_tech_enabled;

        const criteriaHtml = (this.rubric.criteria || []).map((c, idx) => {
            const existing  = this.scores[c.id] || {};
            const noteText  = c.note ? `<div class="r2r-criterion-note">⚠️ ${frappe.utils.escape_html(c.note)}</div>` : '';
            const bandsHtml = c.bands.map(b => `
                <div class="r2r-band">
                    <span class="r2r-band-score">${b.score}</span>
                    <span class="r2r-band-text">${frappe.utils.escape_html(b.text)}</span>
                </div>`).join('');
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
                    placeholder="Notes (optional)"
                    oninput="window.R2R.setNotes('${c.id}', this.value)">${frappe.utils.escape_html(existing.notes || '')}</textarea>
            </div>`;
        }).join('');

        const techBands = (this.rubric.tech.bands || []).map(b => `
            <div class="r2r-band">
                <span class="r2r-band-score">${b.score}</span>
                <span class="r2r-band-text">${frappe.utils.escape_html(b.text)}</span>
            </div>`).join('');

        return `
        <div class="r2r-sp-inner">

            <!-- Live total orb -->
            <div class="r2r-sp-orb" id="score-orb">
                <div class="orb-lbl">Running Total</div>
                <div class="orb-val" id="orb-val">0</div>
                <div class="orb-max">/ 110</div>
                <div class="orb-track"><div class="orb-bar" id="orb-bar" style="width:0%"></div></div>
                <div id="live-cutoff-msg" class="orb-cutoff"></div>
            </div>

            <!-- Score breakdown -->
            <div class="r2r-sp-breakdown">
                <div class="r2r-live-row"><span>Subtotal (1–6):</span><span id="live-subtotal">—</span></div>
                <div class="r2r-live-row"><span>Tech Bonus:</span><span id="live-tech">—</span></div>
                <div class="r2r-live-row"><span>Leverage:</span><span id="live-leverage">—</span></div>
            </div>

            <!-- Scrollable criteria -->
            <div class="r2r-sp-scroll">

                <div class="r2r-sp-section-label">Criteria 1–6</div>
                ${criteriaHtml}

                <!-- Criterion 7: Tech Bonus -->
                <div class="r2r-criterion r2r-tech-crit">
                    <div class="r2r-criterion-header">
                        <div class="r2r-criterion-title">
                            <span class="r2r-crit-num">7</span>
                            Tech Enablement (Bonus)
                            ${isTechEnabled ? '<span class="r2r-tech-flag">⚡ Tech-enabled</span>' : ''}
                        </div>
                        <span class="r2r-crit-max">Max: +5 pts</span>
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


                <!-- Leverage box -->
                <div class="r2r-leverage-box">
                    <div class="r2r-leverage-title">Leverage Points (Extra Credit)</div>
                    <div class="r2r-leverage-cat">
                        <label class="r2r-score-label" style="margin-bottom:4px;display:block;">Round 1 Performance Category:</label>
                        <select id="leverage-select" class="r2r-leverage-select"
                            onchange="window.R2R.setLeverage(this.value)">
                            <option value="None"${this.leverageCategory === 'None' ? ' selected' : ''}>None — +0 pts</option>
                            <option value="At Threshold"${this.leverageCategory === 'At Threshold' ? ' selected' : ''}>At Threshold — +2 pts</option>
                            <option value="Above Threshold"${this.leverageCategory === 'Above Threshold' ? ' selected' : ''}>Above Threshold — +5 pts</option>
                            <option value="Top Shortlisted"${this.leverageCategory === 'Top Shortlisted' ? ' selected' : ''}>Top Shortlisted — +10 pts</option>
                        </select>
                    </div>
                    <label class="r2r-leverage-female-label">
                        <input type="checkbox" id="female-bonus-chk"
                            ${this.isFemale ? 'checked' : ''}
                            onchange="window.R2R.toggleFemale(this.checked)">
                        Female-led applicant bonus (+5 pts)
                    </label>
                    <div class="r2r-leverage-note">Leverage applied only when subtotal ≥ 40 pts</div>
                </div>

                <!-- Overall notes -->
                <div class="r2r-notes-section">
                    <label class="r2r-score-label">Overall Notes (optional):</label>
                    <textarea id="overall-notes" rows="3" class="r2r-notes"
                        placeholder="Overall recommendation…"></textarea>
                </div>

            </div>

            <!-- Submit -->
            <div class="r2r-sp-submit">
                <div class="r2r-submit-warning" id="submit-warning" style="display:none"></div>
                <button class="r2r-submit-btn" id="submit-btn" onclick="window.R2R.submit()">
                    Submit Evaluation
                </button>
                <p class="r2r-submit-hint">Cannot be edited after submission.</p>
            </div>

        </div>`;
    }

    // ── Right panel: read-only ───────────────────────────────────────────────

    renderReadOnlySidebar(evaluation, peerEvals) {
        if (!evaluation) return '<div class="r2r-sp-inner"><p style="padding:20px;color:#aaa;">No evaluation found.</p></div>';

        const r2       = this.appData.r2_applicant;
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

        const tech       = parseInt(evaluation.tech_score || 0);
        const peerHtml   = (peerEvals || []).filter(p => !p.is_own).map(p => `
            <div class="r2r-peer-card">
                <div class="r2r-peer-name">${frappe.utils.escape_html(p.judge_name)}</div>
                <div class="r2r-peer-scores">
                    Sub: <strong>${p.subtotal_score}</strong>
                    + Tech: <strong>${p.tech_bonus}</strong>
                    + Lev: <strong>${p.leverage_points}</strong>
                    = <strong class="${p.passes_cutoff ? 'color-pass' : 'color-fail'}">${p.total_score}</strong>
                    ${p.passes_cutoff ? '✅' : '❌'}
                </div>
            </div>`).join('');

        return `
        <div class="r2r-sp-inner">
            <div class="r2r-sp-orb orb-readonly">
                <div class="orb-lbl">Your Score</div>
                <div class="orb-val" style="color:${evaluation.passes_cutoff ? '#2E7D32' : '#C62828'}">${evaluation.total_score}</div>
                <div class="orb-max">/ 110</div>
                <div class="orb-cutoff" style="color:${evaluation.passes_cutoff ? '#2E7D32' : '#C62828'}">
                    ${evaluation.passes_cutoff ? '✅ Above cut-off' : '❌ Below cut-off'}
                </div>
            </div>

            <div class="r2r-sp-breakdown">
                <div class="r2r-live-row"><span>Subtotal:</span><span>${evaluation.subtotal_score} / 100</span></div>
                <div class="r2r-live-row"><span>Tech Bonus:</span><span>+${evaluation.tech_bonus_points}</span></div>
                <div class="r2r-live-row"><span>Leverage:</span><span>+${evaluation.leverage_points || 0}</span></div>
            </div>

            <div class="r2r-sp-scroll">
                <div class="r2r-sp-section-label">Your Submitted Scores</div>
                <div class="r2r-section r2r-readonly" style="margin:0;border:none;padding:0;">
                    ${critHtml}
                    <div class="r2r-ro-crit">
                        <div class="r2r-ro-crit-name">7. Tech Enablement (Bonus)</div>
                        <div class="r2r-ro-crit-score">
                            Score: <strong>${tech}</strong>/3 → <strong>${this.techBonusPts(tech)}</strong> bonus pts
                        </div>
                    </div>
                </div>
                ${evaluation.overall_notes
                    ? `<div class="r2r-ro-notes" style="padding:10px 0;border-top:1px solid #eee;margin-top:8px;"><strong>Notes:</strong> ${frappe.utils.escape_html(evaluation.overall_notes)}</div>`
                    : ''}
                ${peerHtml ? `
                    <div class="r2r-sp-section-label" style="margin-top:16px;">Peer Evaluations</div>
                    ${peerHtml}` : ''}
            </div>
        </div>`;
    }

    // ── Interactivity ────────────────────────────────────────────────────────

    leveragePts(cat) {
        return { 'Top Shortlisted': 10, 'Above Threshold': 5, 'At Threshold': 2 }[cat] || 0;
    }

    techBonusPts(score) {
        return [0, 2, 3, 5][parseInt(score || 0)] ?? 0;
    }

    setScore(criterionId, value) {
        if (!this.scores[criterionId]) this.scores[criterionId] = {};
        this.scores[criterionId].score = value;
        $(`#btns-${criterionId} .r2r-score-btn`).removeClass('active');
        $(`#btns-${criterionId} .r2r-score-btn:eq(${value})`).addClass('active');
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

    setLeverage(value) {
        this.leverageCategory = value;
        this.recalcLive();
    }

    toggleFemale(checked) {
        this.isFemale = checked;
        this.recalcLive();
    }

    recalcLive() {
        const rubric = this.rubric;
        if (!rubric) return;

        let subtotal = 0;
        (rubric.criteria || []).forEach(c => {
            const s = this.scores[c.id];
            if (s && s.score !== undefined) subtotal += s.score * c.multiplier;
        });

        const techBonus = this.techBonusPts(this.techScore);

        let leverage = 0;
        if (subtotal >= 40) {
            leverage += this.leveragePts(this.leverageCategory);
            if (this.isFemale) leverage += 5;
        }

        const total = subtotal + techBonus + leverage;

        $('#live-subtotal').text(subtotal + ' / 100');
        $('#live-tech').text('+' + techBonus + ' pts');
        $('#live-leverage').text('+' + leverage + ' pts');

        const orbVal = document.getElementById('orb-val');
        const orbBar = document.getElementById('orb-bar');
        const orbEl  = document.getElementById('score-orb');
        const msgEl  = document.getElementById('live-cutoff-msg');

        if (orbVal) orbVal.textContent = total;
        if (orbBar) orbBar.style.width = Math.min(100, (total / 110) * 100) + '%';

        if (orbEl) {
            orbEl.classList.remove('orb-high', 'orb-mid', 'orb-low');
            if (total >= 60)      orbEl.classList.add('orb-high');
            else if (total >= 40) orbEl.classList.add('orb-mid');
            else if (subtotal > 0) orbEl.classList.add('orb-low');
        }

        if (msgEl) {
            msgEl.innerHTML = total >= 60
                ? '<span style="color:#2E7D32">✅ Above cut-off (60)</span>'
                : '<span style="color:#C62828">❌ Below cut-off (60)</span>';
        }
    }

    submit() {
        const rubric  = this.rubric;
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
                notes: this.scores[c.id].notes || '',
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
                leverage_category: this.leverageCategory || 'None',
                female_applicant:  this.isFemale ? 1 : 0,
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
                            ${msg.passes_cutoff
                                ? '<br><b style="color:#2E7D32">✅ Above cut-off (60)</b>'
                                : '<br><b style="color:#C62828">❌ Below cut-off (60)</b>'}
                        `,
                        indicator: msg.passes_cutoff ? 'green' : 'orange',
                    });
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
        /* ── Page shell ── */
        .r2r-page { font-family:var(--font-stack); max-width:1360px; margin:0 auto; padding:16px 16px 0; }

        /* ── Header ── */
        .r2r-header { background:#fff; border:1px solid #e0e0e0; border-radius:10px; padding:18px 22px; margin-bottom:14px; }
        .r2r-header-inner { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; }
        .r2r-header h1 { margin:0 0 4px; font-size:20px; font-weight:700; }
        .r2r-header-meta { font-size:13px; color:#666; margin-bottom:8px; }
        .r2r-badges { display:flex; gap:6px; flex-wrap:wrap; margin-top:6px; }
        .r2r-badge { display:inline-block; padding:3px 10px; border-radius:12px; font-size:11px; font-weight:600; }
        .badge-status   { background:#E3F2FD; color:#1565C0; }
        .badge-leverage { background:#FFF8E1; color:#E65100; }
        .badge-pts      { background:#E8F5E9; color:#2E7D32; }
        .r2r-readonly-banner { margin-top:12px; background:#E8F5E9; color:#2E7D32; padding:8px 12px; border-radius:6px; font-size:13px; font-weight:500; }

        /* ── Two-column body ── */
        .r2r-body { display:flex; gap:16px; align-items:flex-start; padding-bottom:24px; }

        /* ── Left: content ── */
        .r2r-content { flex:1; min-width:0; }
        .r2r-section { background:#fff; border:1px solid #e0e0e0; border-radius:10px; padding:20px 22px; margin-bottom:14px; }
        .r2r-section-highlight { border-left:4px solid #1565C0; }
        .r2r-section-title { margin:0 0 14px; font-size:15px; font-weight:700; color:#333; }
        .r2r-field { margin-bottom:14px; }
        .r2r-field-label { display:block; font-size:11px; font-weight:600; color:#888; text-transform:uppercase; letter-spacing:.5px; margin-bottom:3px; }
        .r2r-field p { margin:0; font-size:13px; color:#333; line-height:1.6; }
        .r2r-prose { font-size:13px; color:#333; line-height:1.7; }
        .r2r-tech-pill { display:inline-block; background:#E3F2FD; color:#1565C0; border-radius:12px; padding:3px 12px; font-size:12px; font-weight:600; margin-bottom:10px; }
        .r2r-link { color:#1565C0; font-size:13px; text-decoration:none; }
        .r2r-link:hover { text-decoration:underline; }
        .r2r-warning { background:#FFF3E0; color:#E65100; padding:8px 12px; border-radius:6px; font-size:12px; }
        .r2r-no-response { background:#FFF3E0; border-color:#FFB74D; }
        .r2r-no-response p { color:#E65100; margin:0; font-size:13px; }

        /* ── Right: sticky sidebar ── */
        .r2r-sidebar {
            width: 400px;
            flex-shrink: 0;
            position: sticky;
            top: 70px;
            max-height: calc(100vh - 90px);
            display: flex;
            flex-direction: column;
            background: #fff;
            border: 1px solid #e0e0e0;
            border-radius: 10px;
            overflow: hidden;
        }
        .r2r-sp-inner { display:flex; flex-direction:column; height:100%; overflow:hidden; }

        /* Orb */
        .r2r-sp-orb { text-align:center; padding:16px 16px 12px; border-bottom:1px solid #f0f0f0; background:#f8f9fa; }
        .r2r-sp-orb.orb-readonly { background:#f8f9fa; }
        .orb-lbl { font-size:11px; color:#888; text-transform:uppercase; letter-spacing:.5px; margin-bottom:2px; }
        .orb-val { font-size:38px; font-weight:800; color:#1565C0; line-height:1.1; }
        .orb-max { font-size:13px; color:#888; margin-bottom:6px; }
        .orb-track { height:6px; background:#eee; border-radius:3px; margin:6px 16px 4px; overflow:hidden; }
        .orb-bar { height:100%; border-radius:3px; background:#1565C0; transition:width .3s; }
        .orb-cutoff { font-size:12px; margin-top:4px; }
        .r2r-sp-orb.orb-high .orb-val, .r2r-sp-orb.orb-high .orb-bar { color:#2E7D32; background:#2E7D32; }
        .r2r-sp-orb.orb-mid  .orb-val { color:#E65100; }
        .r2r-sp-orb.orb-mid  .orb-bar { background:#E65100; }
        .r2r-sp-orb.orb-low  .orb-val { color:#C62828; }
        .r2r-sp-orb.orb-low  .orb-bar { background:#C62828; }

        /* Breakdown strip */
        .r2r-sp-breakdown { display:flex; gap:0; border-bottom:1px solid #f0f0f0; }
        .r2r-live-row { flex:1; display:flex; flex-direction:column; align-items:center; padding:6px 4px; font-size:11px; color:#666; border-right:1px solid #f0f0f0; }
        .r2r-live-row:last-child { border-right:none; }
        .r2r-live-row span:last-child { font-weight:700; color:#333; font-size:13px; margin-top:1px; }

        /* Scrollable criteria */
        .r2r-sp-scroll { flex:1; overflow-y:auto; padding:12px 14px 8px; }
        .r2r-sp-section-label { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.6px; color:#aaa; margin-bottom:8px; }

        /* Criteria cards */
        .r2r-criterion { border:1px solid #e8e8e8; border-radius:8px; padding:12px 14px; margin-bottom:10px; }
        .r2r-tech-crit { border-color:#1565C0; background:#fafcff; }
        .r2r-criterion-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; }
        .r2r-criterion-title { display:flex; align-items:center; gap:6px; font-weight:700; font-size:13px; }
        .r2r-crit-num { background:#1565C0; color:#fff; width:20px; height:20px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:10px; font-weight:700; flex-shrink:0; }
        .r2r-crit-max { font-size:10px; color:#1565C0; font-weight:600; background:#E3F2FD; padding:2px 7px; border-radius:10px; white-space:nowrap; }
        .r2r-criterion-desc { font-size:11px; color:#666; margin:4px 0 6px; line-height:1.4; }
        .r2r-criterion-note { background:#FFF3E0; color:#E65100; font-size:11px; padding:5px 8px; border-radius:4px; margin-bottom:6px; }
        .r2r-tech-flag { font-size:10px; background:#E3F2FD; color:#1565C0; padding:2px 7px; border-radius:10px; margin-left:6px; }
        .r2r-bands { border:1px solid #f0f0f0; border-radius:6px; overflow:hidden; margin-bottom:8px; }
        .r2r-band { display:flex; gap:8px; padding:5px 8px; border-bottom:1px solid #f0f0f0; font-size:11px; }
        .r2r-band:last-child { border-bottom:none; }
        .r2r-band:nth-child(even) { background:#fafafa; }
        .r2r-band-score { font-weight:700; color:#1565C0; width:14px; flex-shrink:0; text-align:center; }
        .r2r-band-text { color:#444; line-height:1.35; }
        .r2r-score-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:4px; }
        .r2r-score-label { font-size:11px; font-weight:600; color:#555; }
        .r2r-score-btns { display:flex; gap:3px; }
        .r2r-score-btn { width:32px; height:32px; border:2px solid #ddd; border-radius:6px; background:#fff; font-size:13px; font-weight:700; cursor:pointer; transition:all .15s; }
        .r2r-score-btn:hover { border-color:#1565C0; color:#1565C0; }
        .r2r-score-btn.active { background:#1565C0; border-color:#1565C0; color:#fff; }
        .r2r-pts-display { font-size:12px; color:#2E7D32; font-weight:600; min-width:48px; }
        .r2r-guiding { font-size:10px; color:#aaa; font-style:italic; margin-bottom:6px; }
        .r2r-notes { width:100%; border:1px solid #ddd; border-radius:6px; padding:6px 8px; font-size:11px; resize:vertical; font-family:var(--font-stack); box-sizing:border-box; }
        .r2r-notes:focus { outline:none; border-color:#1565C0; }

        /* Leverage box */
        .r2r-leverage-box { background:#FFFDE7; border:1px solid #FDD835; border-radius:8px; padding:10px 12px; margin-bottom:10px; }
        .r2r-leverage-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; color:#F57F17; margin-bottom:6px; }
        .r2r-r1-score { font-size:12px; color:#333; margin-bottom:4px; }
        .r2r-r1-none { color:#aaa; font-style:italic; }
        .r2r-leverage-cat { font-size:12px; color:#333; margin-bottom:6px; }
        .r2r-lev-table { width:100%; border-collapse:collapse; font-size:11px; margin-bottom:6px; }
        .r2r-lev-table td { padding:3px 6px; border-bottom:1px solid #FFF59D; color:#555; }
        .r2r-lev-table td:last-child { font-weight:700; color:#2E7D32; text-align:right; }
        .r2r-pts-col { font-weight:700; color:#2E7D32; }
        .r2r-leverage-select { width:100%; border:1px solid #ddd; border-radius:6px; padding:5px 8px; font-size:12px; background:#fff; margin-bottom:6px; }
        .r2r-leverage-female-label { display:flex; align-items:center; gap:6px; font-size:12px; color:#333; margin-bottom:4px; cursor:pointer; }
        .r2r-leverage-female-label input[type=checkbox] { width:14px; height:14px; cursor:pointer; }
        .r2r-leverage-note { font-size:10px; color:#aaa; font-style:italic; }

        /* Notes section */
        .r2r-notes-section { margin-top:10px; }

        /* Submit strip */
        .r2r-sp-submit { padding:12px 14px; border-top:1px solid #f0f0f0; background:#fff; text-align:center; }
        .r2r-submit-btn { background:#1565C0; color:#fff; border:none; padding:10px 28px; font-size:15px; font-weight:700; border-radius:8px; cursor:pointer; transition:background .2s; width:100%; }
        .r2r-submit-btn:hover { background:#0D47A1; }
        .r2r-submit-btn:disabled { background:#aaa; cursor:not-allowed; }
        .r2r-submit-hint { font-size:10px; color:#aaa; margin-top:6px; }
        .r2r-submit-warning { background:#FFEBEE; color:#C62828; padding:7px 12px; border-radius:6px; margin-bottom:8px; font-size:12px; }

        /* Read-only */
        .r2r-readonly {}
        .r2r-ro-crit { padding:8px 0; border-bottom:1px solid #f0f0f0; }
        .r2r-ro-crit:last-child { border-bottom:none; }
        .r2r-ro-crit-name { font-weight:600; font-size:12px; margin-bottom:2px; }
        .r2r-ro-crit-score { font-size:12px; color:#444; }
        .r2r-ro-notes { font-size:11px; color:#888; font-style:italic; margin-top:2px; }
        .r2r-peer-card { background:#f5f5f5; border-radius:6px; padding:8px 12px; margin-bottom:6px; }
        .r2r-peer-name { font-weight:600; font-size:12px; margin-bottom:2px; }
        .r2r-peer-scores { font-size:11px; color:#444; }
        .color-pass { color:#2E7D32; }
        .color-fail { color:#C62828; }

        /* Responsive */
        @media (max-width: 900px) {
            .r2r-body { flex-direction:column; }
            .r2r-sidebar { width:100%; position:static; max-height:none; }
        }
        </style>`;
    }
}
