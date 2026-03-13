/**
 * Judge Review v5
 *
 * ROOT CAUSE OF BROKEN ACCORDION:
 *   jQuery event delegation on page.body accumulates across Frappe page visits.
 *   Even with namespaced .off(), Frappe's router recycles the same DOM node,
 *   so multiple handler instances bind to the same element.
 *   One click fires the handler N times: open → close → open → ...
 *   Net result: accordion appears not to respond.
 *
 * FIX:
 *   NO jQuery event delegation whatsoever.
 *   All interactivity uses inline onclick/onchange calling window.JR.*
 *   window.JR is replaced completely on every render() call, so it always
 *   points to the current instance. One click = exactly one function call.
 */

frappe.pages['judge-review'].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Review Application',
        single_column: true,
    });
    page.set_secondary_action('← Back to Dashboard', () =>
        frappe.set_route('judge-dashboard')
    );
    wrapper._review = new JudgeReviewPage(page);
};

frappe.pages['judge-review'].on_page_show = function (wrapper) {
    if (wrapper._review) {
        const app_id = frappe.get_route()[1];
        if (app_id) wrapper._review.loadApplication(app_id);
        else frappe.set_route('judge-dashboard');
    }
};

class JudgeReviewPage {
    constructor(page) {
        this.page        = page;
        this.wrapper     = $(this.page.body);
        this.application = null;
        this.scores      = {};
        this._savedBonus = false;
        this._savedNotes = '';

        this.criteria = [
            {
                id: 'technical', name: 'Technical Capabilities',
                weight: 0.25, max_score: 10,
                desc: 'Team experience, process/equipment, prototypes, skills gaps',
                bands: [
                    { range: '9-10', mid: 9.5, text: 'Proven track record: 2+ projects deployed, detailed process, precise skills gaps, prior incubation' },
                    { range: '7-8',  mid: 7.5, text: 'Solid experience: 1-2 projects, tested prototype, clear steps' },
                    { range: '5-6',  mid: 5.5, text: 'Basic experience, outline process' },
                    { range: '3-4',  mid: 3.5, text: 'Limited experience, generic gaps' },
                    { range: '1-2',  mid: 1.5, text: 'No evidence of technical capability' },
                ],
            },
            {
                id: 'innovativeness', name: 'Innovativeness',
                weight: 0.25, max_score: 10,
                desc: 'Differentiation from burning/dumping, unique prototype, project stage',
                bands: [
                    { range: '9-10', mid: 9.5, text: 'Breakthrough: patented/AI-optimised, validated, 50%+ improvement quantified' },
                    { range: '7-8',  mid: 7.5, text: 'Clear novelty: new formula tested, beyond concept stage' },
                    { range: '5-6',  mid: 5.5, text: 'Incremental improvement, well described' },
                    { range: '3-4',  mid: 3.5, text: 'Minor tweaks to existing practices' },
                    { range: '1-2',  mid: 1.5, text: 'Mimics common practices — no differentiation' },
                ],
            },
            {
                id: 'scalability', name: 'Scalability & Viability',
                weight: 0.20, max_score: 10,
                desc: '€1k plan, revenue model, job creation',
                bands: [
                    { range: '9-10', mid: 9.5, text: 'Robust plan: 10x scale, >Ksh 100k revenue, 10+ jobs with metrics' },
                    { range: '7-8',  mid: 7.5, text: 'Feasible: doubles scale, Ksh 30k+ revenue, 5-10 jobs quantified' },
                    { range: '5-6',  mid: 5.5, text: 'Basic outline with some revenue and job estimates' },
                    { range: '3-4',  mid: 3.5, text: 'Vague scaling, zero or very low revenue' },
                    { range: '1-2',  mid: 1.5, text: 'No viable growth path' },
                ],
            },
            {
                id: 'impact', name: 'Impact & Sustainability',
                weight: 0.20, max_score: 10,
                desc: 'Environmental facts/figures, community benefits',
                bands: [
                    { range: '9-10', mid: 9.5, text: 'Quantified: 100 tons CO2 averted, 20 jobs, strong community ties' },
                    { range: '7-8',  mid: 7.5, text: 'Solid facts: 50 tons processed, 30% emission reduction' },
                    { range: '5-6',  mid: 5.5, text: 'General claims with some supporting data' },
                    { range: '3-4',  mid: 3.5, text: 'Lists benefits but no metrics' },
                    { range: '1-2',  mid: 1.5, text: 'No evidence of impact' },
                ],
            },
            {
                id: 'presentation', name: 'Completeness & Presentation',
                weight: 0.10, max_score: 1,
                desc: 'Video quality, documents attached, response completeness',
                bands: [
                    { range: '0.9-1.0', mid: 0.95, text: 'Professional video (2+ min demo), full docs, polished' },
                    { range: '0.7-0.8', mid: 0.75, text: 'Good video and documents, application complete' },
                    { range: '0.5-0.6', mid: 0.55, text: 'Basic video, most fields filled' },
                    { range: '0.3-0.4', mid: 0.35, text: 'Partial submission, some fields missing' },
                    { range: '0-0.2',   mid: 0.10, text: 'Missing key elements — video or docs absent' },
                ],
            },
        ];

        this.init();
    }

    init() {
        // Data loading is handled by on_page_show
    }

    loadApplication(app_id) {
        this.wrapper.html(this._loading());
        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.get_application_for_review',
            args:   { application_name: app_id },
            callback: (r) => {
                if (r.message && r.message.success) {
                    this.application = r.message.application;

                    if (r.message.read_only) {
                        // Already submitted — show read-only view with county peer evaluations
                        this.renderReadOnly(r.message.evaluation, r.message.peer_evaluations || []);
                        return;
                    }

                    this.scores = {};
                    const ev = r.message.evaluation;
                    if (ev) {
                        (ev.criteria || []).forEach(c => {
                            this.scores[c.criterion_id] = { score: c.score, notes: c.notes };
                        });
                        this._savedBonus = !!ev.female_led_bonus;
                        this._savedNotes = ev.overall_notes || '';
                    } else {
                        this._savedBonus = false;
                        this._savedNotes = '';
                    }
                    this.render();
                } else {
                    this._renderDenied(r.message && r.message.error ? r.message.error : 'Failed to load application.');
                }
            },
        });
    }

    render() {
        const self = this;
        const app  = this.application;

        // Replace window.JR completely — this instance owns it now.
        window.JR = {
            toggle:      function(cid)       { self._toggle(cid); },
            pickBand:    function(cid, mid)  { self._pickBand(cid, mid); },
            step:        function(cid, dir)  { self._step(cid, dir); },
            updateTotal: function()          { self._updateTotal(); },
            submit:      function()          { self._submit(); },
        };

        this.wrapper.html(
            this._styles() +
            '<div class="rv-page">' +
            this._headerHTML(app) +
            '<div class="rv-body">' +
            '<div class="app-panel">' + this._appContent() + '</div>' +
            '<div class="scoring-panel">' +
            '<div class="sp-head"><h2>Evaluation Rubric</h2>' +
            '<div class="sp-prog-row"><span id="scored-count">0</span>/5 scored' +
            '<div class="sp-bar-bg"><div class="sp-bar-fill" id="sp-bar" style="width:0%"></div></div></div></div>' +
            '<div class="criteria-scroll">' +
            this.criteria.map(function(c) { return self._criterionHTML(c); }).join('') +
            '<div class="bonus-block"><label class="bonus-label">' +
            '<input type="checkbox" id="female-led-bonus"' + (this._savedBonus ? ' checked' : '') + ' onchange="JR.updateTotal()">' +
            '<span class="bonus-text"><strong>Apply Female-Led Bonus (+1 point)</strong>' +
            '<small>Tick if the project is led by a woman or women-owned enterprise.</small>' +
            '</span></label></div>' +
            '<div class="notes-block"><label>Overall Notes</label>' +
            '<textarea id="overall-notes" placeholder="Overall assessment...">' + frappe.utils.escape_html(this._savedNotes) + '</textarea>' +
            '</div>' +
            '</div>' + // .criteria-scroll
            '<div class="sp-submit"><button id="btn-submit" class="btn-submit" onclick="JR.submit()">Submit Evaluation</button>' +
            '<div class="submit-warn">Cannot be edited after submission</div></div>' +
            '</div>' + // .scoring-panel
            '</div>' + // .rv-body
            this._footer() +
            '</div>' // .rv-page
        );

        this._restoreScores();
        this._updateTotal();
    }

    _headerHTML(app) {
        return '<div class="rv-header"><div class="rv-header-inner">' +
            '<div><h1>' + frappe.utils.escape_html(app.full_name) + '</h1>' +
            '<div class="rv-chips">' +
            '<span class="chip">📍 ' + frappe.utils.escape_html(app.county_of_residence || '—') + '</span>' +
            '<span class="chip">' + frappe.utils.escape_html(app.gender || '—') + '</span>' +
            '<span class="chip">' + frappe.utils.escape_html(app.level_of_project || '—') + '</span>' +
            '<span class="chip">' + frappe.utils.escape_html(app.age_group || '—') + '</span>' +
            '</div></div>' +
            '<div class="score-orb" id="score-orb">' +
            '<div class="orb-lbl">Running Total</div>' +
            '<div class="orb-val" id="orb-val">0.00</div>' +
            '<div class="orb-max">/ 10.0</div>' +
            '<div class="orb-track"><div class="orb-bar" id="orb-bar" style="width:0%"></div></div>' +
            '</div>' +
            '</div></div>';
    }

    _criterionHTML(c) {
        var bands = c.bands.map(function(b) {
            var safeId = 'band-' + c.id + '-' + b.range.replace(/[^a-z0-9]/gi, '_');
            return '<div class="band-btn" id="' + safeId + '" onclick="JR.pickBand(\'' + c.id + '\',' + b.mid + ')">' +
                '<div class="band-range">' + b.range + '</div>' +
                '<div class="band-desc">' + b.text + '</div>' +
                '</div>';
        }).join('');

        return '<div class="criterion-row" id="crit-' + c.id + '">' +
            '<div class="criterion-header" onclick="JR.toggle(\'' + c.id + '\')">' +
            '<div class="ch-left">' +
            '<div class="ch-name">' + c.name + ' <span class="ch-weight">' + Math.round(c.weight * 100) + '%</span></div>' +
            '<div class="ch-desc">' + c.desc + '</div>' +
            '</div>' +
            '<div class="ch-right">' +
            '<span class="ch-score" id="display-' + c.id + '">—</span>' +
            '<span class="ch-arrow" id="arrow-' + c.id + '">▾</span>' +
            '</div>' +
            '</div>' +
            '<div class="criterion-body" id="body-' + c.id + '" style="display:none">' +
            '<div class="band-grid">' + bands + '</div>' +
            '<div class="finetune"><span class="ft-lbl">Fine-tune:</span>' +
            '<div class="stepper">' +
            '<button class="step-btn" onclick="JR.step(\'' + c.id + '\',-1)">−</button>' +
            '<div class="step-val" id="score-' + c.id + '">0</div>' +
            '<button class="step-btn" onclick="JR.step(\'' + c.id + '\',1)">+</button>' +
            '</div></div>' +
            '<textarea class="crit-note" id="notes-' + c.id + '" placeholder="Notes for ' + c.name + ' (optional)..."></textarea>' +
            '</div>' + // .criterion-body
            '</div>'; // .criterion-row
    }

    _toggle(cid) {
        var body  = document.getElementById('body-' + cid);
        var arrow = document.getElementById('arrow-' + cid);
        var row   = document.getElementById('crit-' + cid);
        if (!body) return;

        var isOpen = body.style.display !== 'none';

        // Close all first
        var self = this;
        this.criteria.forEach(function(c) {
            var b = document.getElementById('body-' + c.id);
            var a = document.getElementById('arrow-' + c.id);
            var r = document.getElementById('crit-' + c.id);
            if (b) b.style.display = 'none';
            if (a) a.style.transform = '';
            if (r) r.classList.remove('open');
        });

        // Open the target if it was closed
        if (!isOpen) {
            body.style.display    = 'block';
            arrow.style.transform = 'rotate(180deg)';
            row.classList.add('open');
        }
    }

    _pickBand(cid, mid) {
        var c     = this.criteria.find(function(x) { return x.id === cid; });
        var score = parseFloat(Math.max(0, Math.min(c.max_score, mid)).toFixed(1));

        // Deselect all bands for this criterion
        c.bands.forEach(function(b) {
            var el = document.getElementById('band-' + cid + '-' + b.range.replace(/[^a-z0-9]/gi, '_'));
            if (el) el.classList.remove('selected');
        });

        // Select the matching band
        var self = this;
        c.bands.forEach(function(b) {
            if (b.mid === mid) {
                var el = document.getElementById('band-' + cid + '-' + b.range.replace(/[^a-z0-9]/gi, '_'));
                if (el) el.classList.add('selected');
            }
        });

        this._applyScore(cid, score);

        // Auto-advance to next unscored criterion
        var next = this.criteria.find(function(x) {
            return x.id !== cid && (!self.scores[x.id] || self.scores[x.id].score === 0);
        });
        if (next) this._toggle(next.id);
    }

    _step(cid, dir) {
        var c    = this.criteria.find(function(x) { return x.id === cid; });
        var step = c.id === 'presentation' ? 0.1 : 0.5;
        var cur  = this.scores[cid] ? (this.scores[cid].score || 0) : 0;
        var next = parseFloat(Math.max(0, Math.min(c.max_score, cur + dir * step)).toFixed(1));
        this._applyScore(cid, next);
    }

    _applyScore(cid, score) {
        if (!this.scores[cid]) this.scores[cid] = {};
        this.scores[cid].score = score;

        var dispEl = document.getElementById('display-' + cid);
        var stepEl = document.getElementById('score-' + cid);
        var rowEl  = document.getElementById('crit-' + cid);

        if (dispEl) { dispEl.textContent = score.toFixed(1); dispEl.classList.add('set'); }
        if (stepEl)   stepEl.textContent  = score.toFixed(1);
        if (rowEl)    rowEl.classList.add('scored');

        this._updateTotal();
    }

    _updateTotal() {
        var total = 0, scoredCount = 0;
        var self  = this;

        this.criteria.forEach(function(c) {
            var s = self.scores[c.id] ? (self.scores[c.id].score || 0) : 0;
            if (s > 0) scoredCount++;
            total += c.id === 'presentation'
                ? s * c.weight
                : (s / c.max_score) * c.weight * 10;
        });

        var bonusEl = document.getElementById('female-led-bonus');
        var bonus   = bonusEl && bonusEl.checked ? 1 : 0;
        var display = Math.min(10, total + bonus);

        var orbVal = document.getElementById('orb-val');
        var orbBar = document.getElementById('orb-bar');
        var orbEl  = document.getElementById('score-orb');
        var cntEl  = document.getElementById('scored-count');
        var barEl  = document.getElementById('sp-bar');

        if (orbVal) orbVal.textContent = display.toFixed(2);
        if (orbBar) orbBar.style.width = (display / 10 * 100) + '%';
        if (cntEl)  cntEl.textContent  = scoredCount;
        if (barEl)  barEl.style.width  = (scoredCount / 5 * 100) + '%';

        if (orbEl) {
            orbEl.classList.remove('orb-high', 'orb-mid', 'orb-low');
            if (display >= 7)         orbEl.classList.add('orb-high');
            else if (display >= 5)    orbEl.classList.add('orb-mid');
            else if (scoredCount > 0) orbEl.classList.add('orb-low');
        }
    }

    _restoreScores() {
        var self = this;
        this.criteria.forEach(function(c) {
            var s = self.scores[c.id];
            if (s && s.score > 0) {
                self._applyScore(c.id, s.score);
                var noteEl = document.getElementById('notes-' + c.id);
                if (noteEl && s.notes) noteEl.value = s.notes;
            }
        });
    }

    _submit() {
        var self    = this;
        var missing = this.criteria.filter(function(c) {
            return !self.scores[c.id] || self.scores[c.id].score === 0;
        });

        if (missing.length > 0) {
            frappe.msgprint({
                title:     'Incomplete Evaluation',
                message:   'Please score all criteria before submitting:<br><br><strong>' +
                           missing.map(function(c) { return '• ' + c.name; }).join('<br>') + '</strong>',
                indicator: 'orange',
            });
            return;
        }

        var bonusEl = document.getElementById('female-led-bonus');
        var bonus   = bonusEl && bonusEl.checked ? 1 : 0;

        frappe.confirm(
            'Submit this evaluation?<br><small>Cannot be edited after submission.</small>' +
            (bonus ? '<br><small>Female-led bonus (+1) will be applied.</small>' : ''),
            function() {
                self.criteria.forEach(function(c) {
                    if (!self.scores[c.id]) self.scores[c.id] = {};
                    var noteEl = document.getElementById('notes-' + c.id);
                    self.scores[c.id].notes = noteEl ? noteEl.value : '';
                });

                var notesEl  = document.getElementById('overall-notes');
                var submitBtn = document.getElementById('btn-submit');
                if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting...'; }

                frappe.call({
                    method: 'agri_judge.agri_judge.api.judging.submit_evaluation',
                    args: {
                        application_name: self.application.name,
                        criteria_scores:  self.scores,
                        overall_notes:    notesEl ? notesEl.value : '',
                        female_led_bonus: bonus,
                    },
                    callback: function(r) {
                        if (r.message && r.message.success) {
                            frappe.show_alert({ message: 'Submitted! Score: ' + r.message.final_score + '/10', indicator: 'green' }, 4);
                            setTimeout(function() { frappe.set_route('judge-dashboard'); }, 1800);
                        } else {
                            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit Evaluation'; }
                            frappe.msgprint({ title: 'Submission Failed', message: (r.message && r.message.error) || 'An error occurred.', indicator: 'red' });
                        }
                    },
                });
            }
        );
    }

    renderReadOnly(ownEval, peerEvals) {
        var self   = this;
        var app    = this.application;

        // Own evaluation first, then others sorted by score descending
        var sorted = (peerEvals || []).slice().sort(function(a, b) {
            if (b.is_own !== a.is_own) return b.is_own ? 1 : -1;
            return b.final_score - a.final_score;
        });

        var evalCards = sorted.map(function(ev) {
            var criteriaMap = {};
            (ev.criteria || []).forEach(function(c) { criteriaMap[c.criterion_id] = c; });

            var criteriaRows = self.criteria.map(function(c) {
                var cd    = criteriaMap[c.id] || {};
                var score = cd.score || 0;
                return '<div class="ro-crit">' +
                    '<div class="ro-crit-header">' +
                    '<span class="ro-crit-name">' + c.name + ' <span class="ch-weight">' + Math.round(c.weight * 100) + '%</span></span>' +
                    '<span class="ro-crit-score">' + score.toFixed(1) + ' / ' + c.max_score + '</span>' +
                    '</div>' +
                    (cd.notes ? '<div class="ro-crit-notes">' + frappe.utils.escape_html(cd.notes) + '</div>' : '') +
                    '</div>';
            }).join('');

            var scoreClass = ev.final_score >= 7 ? 'orb-high' : ev.final_score >= 5 ? 'orb-mid' : 'orb-low';

            return '<div class="ro-eval-card' + (ev.is_own ? ' ro-own' : '') + '">' +
                '<div class="ro-eval-header">' +
                '<div class="ro-judge-info">' +
                '<span class="ro-judge-name">' + frappe.utils.escape_html(ev.judge_name) + '</span>' +
                (ev.is_own ? '<span class="ro-own-badge">Your Evaluation</span>' : '') +
                '</div>' +
                '<div class="ro-score-badge ' + scoreClass + '">' + ev.final_score.toFixed(2) + '<span>/10</span></div>' +
                '</div>' +
                '<div class="ro-criteria">' + criteriaRows + '</div>' +
                (ev.female_led_bonus ? '<div class="ro-bonus">Female-led bonus applied (+1 pt)</div>' : '') +
                (ev.overall_notes ? '<div class="ro-notes"><strong>Notes:</strong> ' + frappe.utils.escape_html(ev.overall_notes) + '</div>' : '') +
                '</div>';
        }).join('');

        // Build header with own submitted score
        var ownScore = ownEval ? ownEval.final_score : 0;
        var orbClass = ownScore >= 7 ? 'orb-high' : ownScore >= 5 ? 'orb-mid' : 'orb-low';
        var headerHTML = '<div class="rv-header"><div class="rv-header-inner">' +
            '<div><h1>' + frappe.utils.escape_html(app.full_name) + '</h1>' +
            '<div class="rv-chips">' +
            '<span class="chip">📍 ' + frappe.utils.escape_html(app.county_of_residence || '—') + '</span>' +
            '<span class="chip">' + frappe.utils.escape_html(app.gender || '—') + '</span>' +
            '<span class="chip">' + frappe.utils.escape_html(app.level_of_project || '—') + '</span>' +
            '<span class="chip">' + frappe.utils.escape_html(app.age_group || '—') + '</span>' +
            '</div></div>' +
            '<div class="score-orb ' + orbClass + '">' +
            '<div class="orb-lbl">Your Score</div>' +
            '<div class="orb-val">' + ownScore.toFixed(2) + '</div>' +
            '<div class="orb-max">/ 10.0</div>' +
            '<div class="orb-track"><div class="orb-bar" style="width:' + (ownScore / 10 * 100).toFixed(1) + '%"></div></div>' +
            '</div>' +
            '</div></div>';

        this.wrapper.html(
            this._styles() + this._readOnlyStyles() +
            '<div class="rv-page">' +
            headerHTML +
            '<div class="rv-body">' +
            '<div class="app-panel">' + this._appContent() + '</div>' +
            '<div class="scoring-panel">' +
            '<div class="sp-head"><h2>County Evaluations</h2>' +
            '<div style="font-size:12px;color:#888;">' + sorted.length + ' evaluation(s) submitted by judges in your county</div>' +
            '</div>' +
            '<div class="criteria-scroll">' +
            (sorted.length === 0
                ? '<div style="padding:24px;text-align:center;color:#aaa;">No evaluations submitted yet.</div>'
                : evalCards) +
            '</div>' +
            '</div>' +
            '</div>' +
            this._footer() +
            '</div>'
        );
    }

    _readOnlyStyles() {
        return '<style>' +
        '.ro-eval-card{background:#fafafa;border:2px solid #e0e0e0;border-radius:10px;margin-bottom:14px;overflow:hidden;}' +
        '.ro-eval-card.ro-own{border-color:#ED1B2E;background:#fff8f8;}' +
        '.ro-eval-header{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #eee;}' +
        '.ro-judge-info{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}' +
        '.ro-judge-name{font-weight:700;font-size:14px;color:#1a1a1a;}' +
        '.ro-own-badge{background:#ED1B2E;color:white;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;text-transform:uppercase;}' +
        '.ro-score-badge{font-size:22px;font-weight:800;color:#aaa;text-align:right;flex-shrink:0;}' +
        '.ro-score-badge span{font-size:11px;opacity:.6;}' +
        '.ro-score-badge.orb-high{color:#2E7D32;}' +
        '.ro-score-badge.orb-mid{color:#E65100;}' +
        '.ro-score-badge.orb-low{color:#C41E3A;}' +
        '.ro-criteria{padding:8px 14px;}' +
        '.ro-crit{padding:5px 0;border-bottom:1px solid #f2f2f2;}' +
        '.ro-crit:last-child{border-bottom:none;}' +
        '.ro-crit-header{display:flex;justify-content:space-between;align-items:center;}' +
        '.ro-crit-name{font-size:12px;color:#555;font-weight:600;}' +
        '.ro-crit-score{font-size:13px;font-weight:700;color:#ED1B2E;flex-shrink:0;margin-left:8px;}' +
        '.ro-crit-notes{font-size:11px;color:#888;padding:3px 0 2px 8px;border-left:2px solid #ddd;margin-top:3px;font-style:italic;line-height:1.4;}' +
        '.ro-bonus{background:#FFF8E1;color:#E65100;font-size:11px;font-weight:600;padding:5px 14px;border-top:1px solid #FFE082;}' +
        '.ro-notes{padding:10px 14px;font-size:12px;color:#555;background:#f9f9f9;border-top:1px solid #eee;line-height:1.6;}' +
        '</style>';
    }

    _appContent() {
        var app  = this.application;
        var self = this;
        var f    = function(v) { return v ? '<p>' + frappe.utils.escape_html(v) + '</p>' : '<p class="missing">Not provided</p>'; };
        return [
            ['Full Name', app.full_name],
            ['Email', app.email],
            ['Phone', app.phone_number],
            ['Team Experience', app.prior_experience],
            ['Waste Type & Proposed Product', app.proposed_product],
            ['Idea / Prototype', app.describe_your_idea],
            ['Production Process & Equipment', app.production_process],
            ['Environmental Contributions', app.enviromental_contributions],
            ['How It Differs from Burning/Dumping', app.demonstrate_innovativeness],
            ['Use of Euro 1,000 Micro-Grant', app.use_of_micro_grant],
            ['Job Creation & Community Benefits', app.enterprise_benefits],
            ['Skills Needed', app.next_step_skills],
            ['Prior Incubation', app.incubator_programs],
        ].map(function(pair) {
            return '<div class="app-section"><h3>' + pair[0] + '</h3>' + f(pair[1]) + '</div>';
        }).join('') +
        (app.youtube_link ? '<div class="app-section"><h3>Project Video</h3><a class="video-link" href="' + frappe.utils.escape_html(app.youtube_link) + '" target="_blank">Watch on YouTube</a></div>' : '');
    }

    _loading() {
        return this._styles() +
            '<div class="rv-page"><div class="rv-loading"><div style="font-size:36px;margin-bottom:14px">Loading...</div></div>' +
            this._footer() + '</div>';
    }

    _renderDenied(msg) {
        this.wrapper.html(this._styles() +
            '<div class="rv-page"><div class="access-denied">' +
            '<div style="font-size:52px;margin-bottom:18px">Access Denied</div>' +
            '<p>' + frappe.utils.escape_html(msg) + '</p>' +
            '<button class="btn btn-default" onclick="frappe.set_route(\'judge-dashboard\')">Back to Dashboard</button>' +
            '</div>' + this._footer() + '</div>');
    }

    _footer() {
        return '<footer class="krc-footer"><div class="krc-inner"><span class="krc-cross">+</span>' +
            '<span>Built by <strong>Kenya Red Cross - Digital Transformation Unit</strong></span></div>' +
            '<div class="krc-sub">In partnership with <strong>IOMe</strong> &amp; <strong>Airbus</strong> &nbsp;·&nbsp; AgriWaste Innovation Challenge ' + new Date().getFullYear() + '</div></footer>';
    }

    _styles() {
        return '<style>' +
        '.rv-page{background:#f4f5f7;min-height:100vh;display:flex;flex-direction:column;font-family:Arial,sans-serif;}' +
        '.rv-loading{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#aaa;font-size:15px;padding:80px 20px;}' +
        '.rv-header{background:linear-gradient(135deg,#ED1B2E,#C41E3A);color:white;padding:22px 28px;margin-bottom:18px;}' +
        '.rv-header-inner{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px;max-width:1600px;margin:0 auto;}' +
        '.rv-header h1{margin:0 0 8px;font-size:22px;font-weight:700;}' +
        '.rv-chips{display:flex;flex-wrap:wrap;gap:8px;}' +
        '.chip{background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);border-radius:12px;padding:3px 11px;font-size:12px;}' +
        '.score-orb{background:rgba(0,0,0,.18);border:2px solid rgba(255,255,255,.35);border-radius:14px;padding:14px 20px;text-align:center;min-width:120px;flex-shrink:0;}' +
        '.score-orb.orb-high{background:rgba(46,125,50,.45);border-color:rgba(129,199,132,.7);}' +
        '.score-orb.orb-mid{background:rgba(230,81,0,.35);border-color:rgba(255,183,77,.7);}' +
        '.score-orb.orb-low{background:rgba(183,28,28,.45);border-color:rgba(239,154,154,.7);}' +
        '.orb-lbl{font-size:10px;text-transform:uppercase;letter-spacing:.5px;opacity:.75;}' +
        '.orb-val{font-size:32px;font-weight:800;line-height:1.1;}' +
        '.orb-max{font-size:11px;opacity:.6;}' +
        '.orb-track{height:4px;background:rgba(255,255,255,.2);border-radius:2px;margin-top:8px;overflow:hidden;}' +
        '.orb-bar{height:100%;background:white;border-radius:2px;transition:width .4s;}' +
        '.rv-body{display:grid;grid-template-columns:1.5fr 1fr;gap:18px;padding:0 20px 20px;max-width:1600px;margin:0 auto;width:100%;flex:1;box-sizing:border-box;}' +
        '@media(max-width:1100px){.rv-body{grid-template-columns:1fr;}}' +
        '.app-panel{background:white;border-radius:10px;padding:24px 26px;box-shadow:0 2px 8px rgba(0,0,0,.06);overflow-y:auto;}' +
        '.app-section{margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid #f0f0f0;}' +
        '.app-section:last-child{border-bottom:none;margin-bottom:0;}' +
        '.app-section h3{color:#C41E3A;font-size:11px;font-weight:700;margin:0 0 6px;text-transform:uppercase;letter-spacing:.4px;}' +
        '.app-section p{color:#333;line-height:1.75;margin:0;font-size:14px;white-space:pre-wrap;}' +
        '.missing{color:#ccc!important;font-style:italic;}' +
        '.video-link{color:#ED1B2E;font-weight:700;font-size:14px;text-decoration:none;}' +
        '.scoring-panel{background:white;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.06);position:sticky;top:16px;max-height:calc(100vh - 80px);overflow:hidden;display:flex;flex-direction:column;}' +
        '.sp-head{padding:16px 16px 12px;border-bottom:3px solid #ED1B2E;flex-shrink:0;}' +
        '.sp-head h2{margin:0 0 6px;font-size:17px;color:#1a1a1a;}' +
        '.sp-prog-row{display:flex;align-items:center;gap:10px;font-size:12px;color:#888;}' +
        '.sp-bar-bg{flex:1;height:4px;background:#f0f0f0;border-radius:2px;overflow:hidden;}' +
        '.sp-bar-fill{height:100%;background:#ED1B2E;border-radius:2px;transition:width .3s;}' +
        '.criteria-scroll{flex:1;overflow-y:auto;padding:12px;}' +
        '.criterion-row{background:#fafafa;border:2px solid #e8e8e8;border-radius:10px;margin-bottom:10px;overflow:hidden;}' +
        '.criterion-row.scored{border-color:#ED1B2E;background:#fff8f8;}' +
        '.criterion-row.open{border-color:#ED1B2E;}' +
        '.criterion-header{padding:11px 13px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;user-select:none;}' +
        '.criterion-header:hover{background:rgba(237,27,46,.04);}' +
        '.ch-left{flex:1;}' +
        '.ch-name{font-size:13px;font-weight:700;color:#1a1a1a;margin-bottom:2px;display:flex;align-items:center;gap:8px;}' +
        '.ch-weight{background:#ED1B2E;color:white;padding:1px 6px;border-radius:5px;font-size:10px;font-weight:700;}' +
        '.ch-desc{font-size:11px;color:#aaa;line-height:1.3;}' +
        '.ch-right{display:flex;align-items:center;gap:9px;flex-shrink:0;}' +
        '.ch-score{font-size:21px;font-weight:800;color:#ddd;min-width:30px;text-align:right;}' +
        '.ch-score.set{color:#ED1B2E;}' +
        '.ch-arrow{color:#bbb;font-size:11px;display:inline-block;}' +
        '.criterion-body{padding:0 13px 13px;border-top:1px solid #eee;}' +
        '.band-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;margin:12px 0;}' +
        '.band-btn{border:2px solid #e0e0e0;border-radius:8px;padding:8px 5px;text-align:center;cursor:pointer;background:white;transition:border-color .15s,transform .15s;}' +
        '.band-btn:hover{border-color:#ED1B2E;transform:translateY(-2px);}' +
        '.band-btn.selected{border-color:#ED1B2E;background:#fff0f0;box-shadow:0 0 0 2px rgba(237,27,46,.12);}' +
        '.band-range{font-size:13px;font-weight:700;color:#333;margin-bottom:4px;}' +
        '.band-desc{font-size:8.5px;color:#888;line-height:1.3;}' +
        '.finetune{display:flex;align-items:center;justify-content:space-between;background:#f5f5f5;border-radius:8px;padding:8px 12px;margin-bottom:10px;}' +
        '.ft-lbl{font-size:12px;color:#666;font-weight:600;}' +
        '.stepper{display:flex;align-items:center;gap:10px;}' +
        '.step-btn{width:30px;height:30px;border:2px solid #ddd;border-radius:6px;background:white;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}' +
        '.step-btn:hover{border-color:#ED1B2E;color:#ED1B2E;}' +
        '.step-val{font-size:21px;font-weight:800;color:#ED1B2E;min-width:36px;text-align:center;}' +
        '.crit-note{width:100%;border:2px solid #e0e0e0;border-radius:6px;padding:8px;font-size:12px;min-height:52px;resize:vertical;font-family:Arial,sans-serif;box-sizing:border-box;}' +
        '.crit-note:focus{outline:none;border-color:#ED1B2E;}' +
        '.bonus-block{background:#FFF8E1;border:2px solid #FFD54F;border-radius:10px;padding:14px 16px;margin:14px 0 10px;}' +
        '.bonus-label{display:flex;align-items:flex-start;gap:12px;cursor:pointer;}' +
        '.bonus-label input{width:18px;height:18px;margin-top:2px;accent-color:#ED1B2E;flex-shrink:0;cursor:pointer;}' +
        '.bonus-text{font-size:13px;color:#555;line-height:1.5;}' +
        '.bonus-text strong{color:#1a1a1a;display:block;margin-bottom:3px;}' +
        '.bonus-text small{font-size:11px;color:#888;}' +
        '.notes-block{padding:14px;background:#f8f8f8;border-radius:10px;border:2px solid #ED1B2E;margin-top:6px;}' +
        '.notes-block label{display:block;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:#333;margin-bottom:8px;}' +
        '.notes-block textarea{width:100%;border:2px solid #e0e0e0;border-radius:6px;padding:10px;font-size:13px;min-height:85px;resize:vertical;font-family:Arial,sans-serif;box-sizing:border-box;}' +
        '.notes-block textarea:focus{outline:none;border-color:#ED1B2E;}' +
        '.sp-submit{padding:16px;border-top:2px solid #f0f0f0;background:#fafafa;flex-shrink:0;}' +
        '.btn-submit{width:100%;background:linear-gradient(135deg,#ED1B2E,#C41E3A);color:white;border:none;padding:13px;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;font-family:Arial,sans-serif;}' +
        '.btn-submit:hover:not([disabled]){opacity:.9;}' +
        '.btn-submit[disabled]{background:#ccc;cursor:not-allowed;}' +
        '.submit-warn{text-align:center;color:#bbb;font-size:11px;margin-top:7px;}' +
        '.access-denied{flex:1;max-width:520px;margin:60px auto;background:white;border-radius:12px;padding:48px 38px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.1);border-top:5px solid #ED1B2E;}' +
        '.access-denied p{color:#555;line-height:1.7;margin-bottom:26px;font-size:14px;}' +
        '.krc-footer{margin-top:32px;border-top:2px solid #e8e8e8;padding:16px 20px 22px;background:white;text-align:center;font-family:Arial,sans-serif;}' +
        '.krc-inner{display:flex;align-items:center;justify-content:center;gap:10px;font-size:13px;color:#555;margin-bottom:4px;}' +
        '.krc-cross{font-size:20px;color:#ED1B2E;font-weight:900;}' +
        '.krc-inner strong{color:#ED1B2E;}' +
        '.krc-sub{font-size:12px;color:#aaa;}' +
        '.krc-sub strong{color:#777;}' +
        '</style>';
    }
}
