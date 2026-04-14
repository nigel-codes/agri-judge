/**
 * Round 2 Response Review v1
 * Coordinator-only. Full-page view of a single Round 2 Response.
 * - Left panel: all submission fields + attachments
 * - Right panel: sticky score (0–10) + notes + save
 *
 * Uses window.R2R.* for all interactivity (no jQuery delegation)
 * to avoid handler-accumulation issues across Frappe page visits.
 */

frappe.pages['round-2-response-review'].on_page_load = function(wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Review Round 2 Response',
        single_column: true,
    });
    page.set_secondary_action('← Back to Judging List', () =>
        frappe.set_route('round-2-judging')
    );
    wrapper._r2rr = new Round2ResponseReview(page);
};

frappe.pages['round-2-response-review'].on_page_show = function(wrapper) {
    if (wrapper._r2rr) {
        const name = frappe.get_route()[1];
        if (name) wrapper._r2rr.load(name);
        else frappe.set_route('round-2-judging');
    }
};

class Round2ResponseReview {
    constructor(page) {
        this.page     = page;
        this.wrapper  = $(this.page.body);
        this.response = null;
    }

    load(name) {
        this.wrapper.html(this._loading());
        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.get_round2_response_for_review',
            args: { response_name: name },
            callback: (r) => {
                if (r.message && r.message.success) {
                    this.response         = r.message.response;
                    this.attachments      = r.message.attachments || [];
                    this.round1Application = r.message.round1_application || null;
                    this.render();
                } else {
                    this._renderError((r.message && r.message.error) || 'Failed to load response.');
                }
            },
        });
    }

    render() {
        const self = this;
        const res  = this.response;

        window.R2R = {
            save:       function() { self._save(); },
            step:       function(dir) { self._step(dir); },
            updateBar:  function() { self._updateBar(); },
            toggleR1:   function() { self._toggleR1(); },
        };

        this.wrapper.html(
            this._styles() +
            '<div class="rv-page">' +
            this._header(res) +
            '<div class="rv-body">' +
            '<div class="app-panel">' + this._appContent(res) + this._round1Section(this.round1Application) + '</div>' +
            '<div class="scoring-panel">' + this._scoringPanel(res) + '</div>' +
            '</div>' +
            this._footer() +
            '</div>'
        );
    }

    _header(res) {
        const county = res.county === 'Other' && res.county_other
            ? res.county_other
            : (res.county || '—');
        const score   = res.score || 0;
        const orbClass = score >= 7 ? 'orb-high' : score >= 5 ? 'orb-mid' : score > 0 ? 'orb-low' : '';
        const devShort = (res.developmental_level || '').split('(')[0].trim() || '—';

        return '<div class="rv-header"><div class="rv-header-inner">' +
            '<div>' +
            '<h1>' + frappe.utils.escape_html(res.applicant_name) + '</h1>' +
            '<div class="rv-chips">' +
            '<span class="chip">📍 ' + frappe.utils.escape_html(county) + '</span>' +
            (res.gender    ? '<span class="chip">' + frappe.utils.escape_html(res.gender) + '</span>' : '') +
            (res.age       ? '<span class="chip">Age ' + frappe.utils.escape_html(String(res.age)) + '</span>' : '') +
            '<span class="chip">' + frappe.utils.escape_html(devShort) + '</span>' +
            (res.is_tech_enabled ? '<span class="chip chip-tech">Tech-enabled</span>' : '') +
            '</div>' +
            '</div>' +
            '<div class="score-orb ' + orbClass + '" id="score-orb">' +
            '<div class="orb-lbl">' + (score > 0 ? 'Current Score' : 'Not Scored') + '</div>' +
            '<div class="orb-val" id="orb-val">' + (score > 0 ? score.toFixed(1) : '—') + '</div>' +
            '<div class="orb-max">/ 10</div>' +
            '<div class="orb-track"><div class="orb-bar" id="orb-bar" style="width:' + (score / 10 * 100).toFixed(1) + '%"></div></div>' +
            '</div>' +
            '</div></div>';
    }

    _appContent(res) {
        const field = (label, value) => {
            const body = value
                ? '<p>' + frappe.utils.escape_html(value) + '</p>'
                : '<p class="missing">Not provided</p>';
            return '<div class="app-section"><h3>' + label + '</h3>' + body + '</div>';
        };

        const richField = (label, value) => {
            const body = value
                ? '<div class="rich-content">' + value + '</div>'
                : '<p class="missing">Not provided</p>';
            return '<div class="app-section"><h3>' + label + '</h3>' + body + '</div>';
        };

        let html = '';

        // Basic info
        html += field('Full Name',            res.applicant_name);
        html += field('County',               res.county === 'Other' && res.county_other ? res.county_other : res.county);
        html += field('Gender',               res.gender);
        html += field('Age',                  res.age ? String(res.age) : '');
        html += field('Developmental Level',  res.developmental_level);
        html += field('Tech-Enabled',         res.is_tech_enabled ? 'Yes' : 'No');

        // Rich text fields
        html += richField('Innovation / Project Description', res.innovation_description);
        html += richField('Resources & Skills Needed',        res.resources_needed);

        // Attachments
        const files = this.attachments;
        if (files.length > 0) {
            const links = files.map(f => {
                const label = f.label
                    ? '<strong>' + frappe.utils.escape_html(f.label) + ':</strong> '
                    : '';
                return '<div class="attach-item">' + label +
                    '<a href="' + frappe.utils.escape_html(f.file_url) + '" target="_blank" class="attach-link">' +
                    '📎 ' + frappe.utils.escape_html(f.file_name) +
                    '</a></div>';
            }).join('');
            html += '<div class="app-section"><h3>Attachments</h3>' + links + '</div>';
        } else {
            html += '<div class="app-section"><h3>Attachments</h3><p class="missing">No attachments uploaded</p></div>';
        }

        return html;
    }

    _round1Section(app) {
        if (!app) {
            return '<div class="r1-section">' +
                '<div class="r1-toggle" onclick="R2R.toggleR1()">' +
                '<span class="r1-toggle-icon" id="r1-icon">▶</span>' +
                '<span>Round 1 Application</span>' +
                '<span class="r1-no-link">No linked Round 1 application found</span>' +
                '</div>' +
                '</div>';
        }

        const field = (label, value) => {
            if (!value) return '';
            return '<div class="r1-field"><span class="r1-field-label">' + label + '</span>' +
                '<p class="r1-field-value">' + frappe.utils.escape_html(value) + '</p></div>';
        };

        const youtubeBtn = app.youtube_link
            ? '<div class="r1-field"><span class="r1-field-label">Video</span>' +
              '<a href="' + frappe.utils.escape_html(app.youtube_link) + '" target="_blank" class="r1-yt-link">▶ Watch Video</a></div>'
            : '';

        const docsBtn = app.supporting_documents
            ? '<div class="r1-field"><span class="r1-field-label">Supporting Documents</span>' +
              '<a href="' + frappe.utils.escape_html(app.supporting_documents) + '" target="_blank" class="attach-link">📎 View Document</a></div>'
            : '';

        const body =
            field('Prior Experience',           app.prior_experience) +
            field('Proposed Product / Waste',   app.proposed_product) +
            field('Idea / Prototype',           app.describe_your_idea) +
            field('Project Level',              app.level_of_project) +
            field('Production Process',         app.production_process) +
            field('Environmental Contributions',app.enviromental_contributions) +
            field('Monthly Revenue',            app.monthly_revenue) +
            field('Innovativeness',             app.demonstrate_innovativeness) +
            field('Use of Micro-Grant (€1,000)',app.use_of_micro_grant) +
            field('Enterprise Benefits',        app.enterprise_benefits) +
            field('Next-Step Skills Needed',    app.next_step_skills) +
            field('Incubator Programs',         app.incubator_programs) +
            youtubeBtn +
            docsBtn;

        return '<div class="r1-section">' +
            '<div class="r1-toggle" onclick="R2R.toggleR1()">' +
            '<span class="r1-toggle-icon" id="r1-icon">▶</span>' +
            '<span>Round 1 Application</span>' +
            '<span class="r1-ref">' + frappe.utils.escape_html(app.name) + '</span>' +
            '</div>' +
            '<div class="r1-body" id="r1-body" style="display:none;">' +
            body +
            '</div>' +
            '</div>';
    }

    _toggleR1() {
        const body = document.getElementById('r1-body');
        const icon = document.getElementById('r1-icon');
        if (!body) return;
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : 'block';
        if (icon) icon.textContent = open ? '▶' : '▼';
    }

    _scoringPanel(res) {
        const hasScore = res.score > 0;
        const metaLine = res.scored_by
            ? '<div class="score-meta">Last saved by <strong>' +
              frappe.utils.escape_html(res.scored_by_name || res.scored_by) + '</strong>' +
              (res.scored_on ? '<br>' + frappe.datetime.str_to_user(res.scored_on) : '') +
              '</div>'
            : '';

        return '<div class="sp-head">' +
            '<h2>Coordinator Score</h2>' +
            '<div class="sp-sub">Score this submission out of 10</div>' +
            '</div>' +
            '<div class="sp-body">' +
            '<div class="sp-score-block">' +
            '<label class="sp-label">Score (0 – 10)</label>' +
            '<div class="score-stepper">' +
            '<button class="step-btn" onclick="R2R.step(-0.5)">−</button>' +
            '<input type="number" id="r2-score" class="score-big-input" ' +
            'min="0" max="10" step="0.5" ' +
            'value="' + (hasScore ? res.score.toFixed(1) : '') + '" ' +
            'placeholder="0 – 10" ' +
            'oninput="R2R.updateBar()">' +
            '<button class="step-btn" onclick="R2R.step(0.5)">+</button>' +
            '</div>' +
            '<div class="score-bar-wrap"><div class="score-bar-fill" id="score-bar-fill" style="width:' + (hasScore ? (res.score / 10 * 100).toFixed(1) : '0') + '%"></div></div>' +
            '</div>' +
            '<div class="sp-notes-block">' +
            '<label class="sp-label">Notes</label>' +
            '<textarea id="r2-notes" placeholder="Optional assessment notes…">' +
            frappe.utils.escape_html(res.score_notes || '') +
            '</textarea>' +
            '</div>' +
            metaLine +
            '</div>' +
            '<div class="sp-footer">' +
            '<button class="btn-save" id="btn-save-score" onclick="R2R.save()">Save Score</button>' +
            '</div>';
    }

    _step(dir) {
        const el  = document.getElementById('r2-score');
        if (!el) return;
        const cur = parseFloat(el.value) || 0;
        el.value  = Math.max(0, Math.min(10, cur + dir)).toFixed(1);
        this._updateBar();
    }

    _updateBar() {
        const el  = document.getElementById('r2-score');
        const bar = document.getElementById('score-bar-fill');
        if (!el || !bar) return;
        const v = parseFloat(el.value) || 0;
        bar.style.width = (Math.min(10, Math.max(0, v)) / 10 * 100).toFixed(1) + '%';
    }

    _save() {
        const scoreEl = document.getElementById('r2-score');
        const notesEl = document.getElementById('r2-notes');
        const btn     = document.getElementById('btn-save-score');

        const score = parseFloat(scoreEl ? scoreEl.value : '');
        const notes = notesEl ? notesEl.value : '';

        if (isNaN(score) || score < 0 || score > 10) {
            frappe.show_alert({ message: 'Score must be between 0 and 10.', indicator: 'red' });
            return;
        }

        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.save_round2_score',
            args: { response_name: this.response.name, score: score, notes: notes },
            callback: (r) => {
                if (btn) { btn.disabled = false; btn.textContent = 'Save Score'; }
                if (r.message && r.message.success) {
                    frappe.show_alert({ message: 'Score saved', indicator: 'green' });
                    this.response.score        = score;
                    this.response.score_notes  = notes;
                    this.response.scored_by    = r.message.scored_by;
                    this.response.scored_by_name = r.message.scored_by_name;
                    this.response.scored_on    = r.message.scored_on;
                    this._refreshOrb(score);
                    this._refreshMeta(r.message);
                } else {
                    frappe.show_alert({ message: (r.message && r.message.error) || 'Failed to save.', indicator: 'red' });
                }
            },
        });
    }

    _refreshOrb(score) {
        const orbEl  = document.getElementById('score-orb');
        const orbVal = document.getElementById('orb-val');
        const orbBar = document.getElementById('orb-bar');
        const bar    = document.getElementById('score-bar-fill');

        if (orbVal) orbVal.textContent = score.toFixed(1);
        if (orbBar) orbBar.style.width = (score / 10 * 100).toFixed(1) + '%';
        if (bar)    bar.style.width    = (score / 10 * 100).toFixed(1) + '%';
        if (orbEl) {
            orbEl.classList.remove('orb-high', 'orb-mid', 'orb-low');
            if (score >= 7)      orbEl.classList.add('orb-high');
            else if (score >= 5) orbEl.classList.add('orb-mid');
            else if (score > 0)  orbEl.classList.add('orb-low');
            orbEl.querySelector('.orb-lbl').textContent = 'Current Score';
        }
    }

    _refreshMeta(msg) {
        const existing = this.wrapper.find('.score-meta');
        const html = '<div class="score-meta">Last saved by <strong>' +
            frappe.utils.escape_html(msg.scored_by_name || msg.scored_by) +
            '</strong>' +
            (msg.scored_on ? '<br>' + frappe.datetime.str_to_user(msg.scored_on) : '') +
            '</div>';
        if (existing.length) existing.replaceWith(html);
        else this.wrapper.find('.sp-body').append(html);
    }

    _loading() {
        return this._styles() +
            '<div class="rv-page"><div class="rv-loading">' +
            '<div style="font-size:36px;margin-bottom:14px">Loading…</div>' +
            '</div>' + this._footer() + '</div>';
    }

    _renderError(msg) {
        this.wrapper.html(this._styles() +
            '<div class="rv-page"><div class="access-denied">' +
            '<div style="font-size:52px;margin-bottom:18px">⚠️</div>' +
            '<p>' + frappe.utils.escape_html(msg) + '</p>' +
            '<button class="btn btn-default" onclick="frappe.set_route(\'round-2-judging\')">Back to Judging List</button>' +
            '</div>' + this._footer() + '</div>');
    }

    _footer() {
        return '<footer class="krc-footer">' +
            '<div class="krc-inner"><span class="krc-cross">+</span>' +
            '<span>Built by <strong>Kenya Red Cross – Digital Transformation Unit</strong></span></div>' +
            '<div class="krc-sub">In partnership with <strong>IOMe</strong> &amp; <strong>Airbus</strong> &nbsp;·&nbsp; AgriWaste Innovation Challenge ' + new Date().getFullYear() + '</div>' +
            '</footer>';
    }

    _styles() {
        return '<style>' +
        /* Page shell */
        '.rv-page{background:#f4f5f7;min-height:100vh;display:flex;flex-direction:column;font-family:Arial,sans-serif;}' +
        '.rv-loading{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#aaa;font-size:15px;padding:80px 20px;}' +

        /* Header */
        '.rv-header{background:linear-gradient(135deg,#1565C0,#0D47A1);color:white;padding:22px 28px;margin-bottom:18px;}' +
        '.rv-header-inner{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px;max-width:1600px;margin:0 auto;}' +
        '.rv-header h1{margin:0 0 8px;font-size:22px;font-weight:700;}' +
        '.rv-chips{display:flex;flex-wrap:wrap;gap:8px;}' +
        '.chip{background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);border-radius:12px;padding:3px 11px;font-size:12px;}' +
        '.chip-tech{background:rgba(255,255,255,.25);font-weight:700;}' +

        /* Score orb in header */
        '.score-orb{background:rgba(0,0,0,.18);border:2px solid rgba(255,255,255,.35);border-radius:14px;padding:14px 20px;text-align:center;min-width:120px;flex-shrink:0;}' +
        '.score-orb.orb-high{background:rgba(46,125,50,.45);border-color:rgba(129,199,132,.7);}' +
        '.score-orb.orb-mid{background:rgba(230,81,0,.35);border-color:rgba(255,183,77,.7);}' +
        '.score-orb.orb-low{background:rgba(183,28,28,.45);border-color:rgba(239,154,154,.7);}' +
        '.orb-lbl{font-size:10px;text-transform:uppercase;letter-spacing:.5px;opacity:.75;}' +
        '.orb-val{font-size:32px;font-weight:800;line-height:1.1;}' +
        '.orb-max{font-size:11px;opacity:.6;}' +
        '.orb-track{height:4px;background:rgba(255,255,255,.2);border-radius:2px;margin-top:8px;overflow:hidden;}' +
        '.orb-bar{height:100%;background:white;border-radius:2px;transition:width .4s;}' +

        /* Body layout */
        '.rv-body{display:grid;grid-template-columns:1.5fr 1fr;gap:18px;padding:0 20px 20px;max-width:1600px;margin:0 auto;width:100%;flex:1;box-sizing:border-box;}' +
        '@media(max-width:1100px){.rv-body{grid-template-columns:1fr;}}' +

        /* Left panel */
        '.app-panel{background:white;border-radius:10px;padding:24px 26px;box-shadow:0 2px 8px rgba(0,0,0,.06);overflow-y:auto;}' +
        '.app-section{margin-bottom:20px;padding-bottom:18px;border-bottom:1px solid #f0f0f0;}' +
        '.app-section:last-child{border-bottom:none;margin-bottom:0;}' +
        '.app-section h3{color:#1565C0;font-size:11px;font-weight:700;margin:0 0 7px;text-transform:uppercase;letter-spacing:.4px;}' +
        '.app-section p{color:#333;line-height:1.75;margin:0;font-size:14px;}' +
        '.missing{color:#ccc!important;font-style:italic;}' +
        '.rich-content{font-size:14px;color:#333;line-height:1.75;}' +
        '.rich-content .ql-editor{padding:0;border:none;font-size:14px;}' +
        '.rich-content p{margin:0 0 8px;}' +
        '.attach-item{margin-bottom:8px;}' +
        '.attach-link{color:#1565C0;font-size:14px;font-weight:600;text-decoration:none;}' +
        '.attach-link:hover{text-decoration:underline;}' +

        /* Right panel */
        '.scoring-panel{background:white;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.06);position:sticky;top:16px;max-height:calc(100vh - 80px);overflow:hidden;display:flex;flex-direction:column;}' +
        '.sp-head{padding:18px 18px 14px;border-bottom:3px solid #1565C0;flex-shrink:0;}' +
        '.sp-head h2{margin:0 0 4px;font-size:17px;color:#1a1a1a;}' +
        '.sp-sub{font-size:12px;color:#888;}' +
        '.sp-body{flex:1;overflow-y:auto;padding:18px;}' +
        '.sp-label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#555;margin-bottom:8px;}' +

        /* Score stepper */
        '.sp-score-block{margin-bottom:20px;}' +
        '.score-stepper{display:flex;align-items:center;gap:10px;margin-bottom:10px;}' +
        '.step-btn{width:36px;height:36px;border:2px solid #ddd;border-radius:8px;background:white;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;flex-shrink:0;}' +
        '.step-btn:hover{border-color:#1565C0;color:#1565C0;}' +
        '.score-big-input{flex:1;border:2px solid #d0d0d0;border-radius:8px;padding:10px;font-size:28px;font-weight:800;text-align:center;color:#1565C0;outline:none;width:100%;box-sizing:border-box;}' +
        '.score-big-input:focus{border-color:#1565C0;}' +
        '.score-bar-wrap{height:6px;background:#f0f0f0;border-radius:3px;overflow:hidden;}' +
        '.score-bar-fill{height:100%;background:#1565C0;border-radius:3px;transition:width .3s;}' +

        /* Notes */
        '.sp-notes-block{margin-bottom:16px;}' +
        '.sp-notes-block textarea{width:100%;border:2px solid #e0e0e0;border-radius:8px;padding:10px;font-size:13px;min-height:100px;resize:vertical;font-family:Arial,sans-serif;box-sizing:border-box;}' +
        '.sp-notes-block textarea:focus{outline:none;border-color:#1565C0;}' +

        /* Scored-by meta */
        '.score-meta{font-size:12px;color:#888;padding:8px 0;line-height:1.5;}' +
        '.score-meta strong{color:#555;}' +

        /* Footer save button */
        '.sp-footer{padding:16px 18px;border-top:2px solid #f0f0f0;background:#fafafa;flex-shrink:0;}' +
        '.btn-save{width:100%;background:linear-gradient(135deg,#1565C0,#0D47A1);color:white;border:none;padding:13px;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;font-family:Arial,sans-serif;}' +
        '.btn-save:hover:not([disabled]){opacity:.9;}' +
        '.btn-save[disabled]{background:#ccc;cursor:not-allowed;}' +

        /* Error / access denied */
        '.access-denied{flex:1;max-width:520px;margin:60px auto;background:white;border-radius:12px;padding:48px 38px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,.1);border-top:5px solid #1565C0;}' +
        '.access-denied p{color:#555;line-height:1.7;margin-bottom:26px;font-size:14px;}' +

        /* Round 1 section */
        '.r1-section{margin-top:24px;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;}' +
        '.r1-toggle{display:flex;align-items:center;gap:10px;padding:12px 16px;background:#f0f4ff;cursor:pointer;font-weight:700;font-size:13px;color:#1565C0;user-select:none;}' +
        '.r1-toggle:hover{background:#e3ecff;}' +
        '.r1-toggle-icon{font-size:11px;color:#1565C0;flex-shrink:0;}' +
        '.r1-ref{margin-left:auto;font-size:11px;font-weight:400;color:#999;font-style:italic;}' +
        '.r1-no-link{margin-left:auto;font-size:11px;font-weight:400;color:#bbb;font-style:italic;}' +
        '.r1-body{padding:16px 18px;border-top:1px solid #e8e8e8;background:#fafbff;}' +
        '.r1-field{margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #f0f0f0;}' +
        '.r1-field:last-child{border-bottom:none;margin-bottom:0;padding-bottom:0;}' +
        '.r1-field-label{display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#1565C0;margin-bottom:5px;}' +
        '.r1-field-value{margin:0;font-size:13px;color:#333;line-height:1.7;white-space:pre-wrap;}' +
        '.r1-yt-link{display:inline-block;background:#E53935;color:white;padding:5px 14px;border-radius:6px;font-size:12px;font-weight:700;text-decoration:none;}' +
        '.r1-yt-link:hover{opacity:.85;}' +

        /* Footer */
        '.krc-footer{margin-top:32px;border-top:2px solid #e8e8e8;padding:16px 20px 22px;background:white;text-align:center;font-family:Arial,sans-serif;}' +
        '.krc-inner{display:flex;align-items:center;justify-content:center;gap:10px;font-size:13px;color:#555;margin-bottom:4px;}' +
        '.krc-cross{font-size:20px;color:#1565C0;font-weight:900;}' +
        '.krc-inner strong{color:#1565C0;}' +
        '.krc-sub{font-size:12px;color:#aaa;}' +
        '.krc-sub strong{color:#777;}' +
        '</style>';
    }
}
