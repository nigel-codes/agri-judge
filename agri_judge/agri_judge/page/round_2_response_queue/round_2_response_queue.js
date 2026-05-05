/**
 * Round 2 — Response Queue
 * Coordinator-only. Lists all Round 2 Responses newest-first so late/invited
 * applicants surface at the top. Shows received date and judge scoring status.
 */

frappe.pages['round-2-response-queue'].on_page_load = function(wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Round 2 — Response Queue',
        single_column: true
    });
    page.add_button('← R2 Judging', () => frappe.set_route('round-2-judging'), 'octicon octicon-arrow-left');
    page.add_button('Scoring Dashboard', () => frappe.set_route('round-2-scoring-dashboard'), 'octicon octicon-dashboard');
    page.set_primary_action('Refresh', () => wrapper._rq && wrapper._rq.load(), 'octicon octicon-sync');
    wrapper._rq = new R2ResponseQueue(page, wrapper);
};

frappe.pages['round-2-response-queue'].on_page_show = function(wrapper) {
    if (wrapper._rq) wrapper._rq.load();
};

class R2ResponseQueue {
    constructor(page, wrapper) {
        this.page    = page;
        this.wrapper = $(wrapper).find('.page-content');
        this.data    = [];
        this.filter  = 'all';
    }

    load() {
        this.wrapper.html(this.loadingHtml());
        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.get_r2_response_queue',
            callback: (r) => {
                if (r.message && r.message.success) {
                    this.data = r.message.responses || [];
                    this.render();
                } else {
                    this.renderError(r.message?.error || 'Failed to load response queue.');
                }
            }
        });
    }

    visibleRows() {
        if (this.filter === 'no_judges') return this.data.filter(r => r.judge_count === 0);
        if (this.filter === 'unscored')  return this.data.filter(r => r.coord_score === null);
        return this.data;
    }

    render() {
        const total     = this.data.length;
        const noJudges  = this.data.filter(r => r.judge_count === 0).length;
        const judged    = this.data.filter(r => r.judge_count > 0).length;
        const unscored  = this.data.filter(r => r.coord_score === null).length;

        const rows = this.visibleRows();

        const filterBtns = `
            <div class="rq-filters">
                <button class="rq-filter-btn ${this.filter==='all'?'active':''}" data-filter="all">
                    All <span class="rq-filter-count">${total}</span>
                </button>
                <button class="rq-filter-btn ${this.filter==='no_judges'?'active':''}" data-filter="no_judges">
                    No Judges Yet <span class="rq-filter-count">${noJudges}</span>
                </button>
                <button class="rq-filter-btn ${this.filter==='unscored'?'active':''}" data-filter="unscored">
                    Unscored by Coordinator <span class="rq-filter-count">${unscored}</span>
                </button>
            </div>`;

        const tableBody = rows.length === 0
            ? `<tr><td colspan="6" class="rq-empty-row">No responses match this filter.</td></tr>`
            : rows.map((r, i) => this.renderRow(r, i + 1)).join('');

        this.wrapper.html(`
            ${this.getStyles()}
            <div class="rq-wrap">

                <div class="rq-header">
                    <div class="rq-header-inner">
                        <div>
                            <h1>Round 2 — Response Queue</h1>
                            <p class="rq-subtitle">Newest submissions first &middot; Late applicants appear at the top</p>
                        </div>
                        <div class="rq-coord-badge">Coordinator View</div>
                    </div>
                </div>

                <div class="rq-stats">
                    ${this.statCard(total,    'Total Responses',    '#1565C0')}
                    ${this.statCard(judged,   'Judge Evaluated',    '#2E7D32')}
                    ${this.statCard(noJudges, 'No Judge Score Yet', '#E65100')}
                    ${this.statCard(unscored, 'Not Coord-Scored',   '#78909C')}
                </div>

                <div class="rq-legend">
                    <span class="rq-badge badge-none">No judges yet</span>
                    <span class="rq-badge badge-partial">1 judge scored</span>
                    <span class="rq-badge badge-done">2+ judges scored</span>
                    <span class="rq-note">Click any row to view the full response</span>
                </div>

                ${filterBtns}

                <div class="rq-table-wrap">
                    <table class="rq-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Applicant Name</th>
                                <th>County</th>
                                <th>Received</th>
                                <th>Coord Score</th>
                                <th>Judge Evaluations</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableBody}
                        </tbody>
                    </table>
                </div>

                <div class="rq-footer">
                    Round 2 Response Queue &middot; Agri Judge &middot; ${new Date().getFullYear()}
                </div>
            </div>
        `);

        // Row click → open full criteria judging form, flagging source so back button returns here
        this.wrapper.on('click', '.rq-row', function() {
            const name = $(this).data('name');
            if (name) {
                frappe.route_options = { source: 'queue' };
                frappe.set_route('round-2-judge-review', name);
            }
        });

        // Filter buttons
        const self = this;
        this.wrapper.on('click', '.rq-filter-btn', function() {
            self.filter = $(this).data('filter');
            self.render();
        });
    }

    renderRow(r, pos) {
        const received = r.received_on
            ? this.formatDate(r.received_on)
            : '—';

        const scoreDisplay = r.coord_score !== null
            ? `<span class="rq-coord-score">${r.coord_score}<span class="rq-of">/10</span></span>`
            : `<span class="rq-unscored">Not scored</span>`;

        let judgeBadge;
        if (r.judge_count === 0) {
            judgeBadge = `<span class="rq-badge badge-none">No judges yet</span>`;
        } else if (r.judge_count === 1) {
            judgeBadge = `<span class="rq-badge badge-partial">1 judge scored</span>`;
        } else {
            judgeBadge = `<span class="rq-badge badge-done">${r.judge_count} judges scored</span>`;
        }

        return `
        <tr class="rq-row" data-name="${frappe.utils.escape_html(r.name)}">
            <td class="td-pos">${pos}</td>
            <td class="td-name">${frappe.utils.escape_html(r.applicant_name || r.name)}</td>
            <td class="td-county">${frappe.utils.escape_html(r.county || '—')}</td>
            <td class="td-date">${received}</td>
            <td class="td-score">${scoreDisplay}</td>
            <td class="td-judges">${judgeBadge}</td>
        </tr>`;
    }

    formatDate(isoStr) {
        try {
            const d = new Date(isoStr);
            const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            return `${date}, ${time}`;
        } catch (_) {
            return isoStr;
        }
    }

    statCard(value, label, color) {
        return `
        <div class="rq-stat-card" style="border-top-color:${color};">
            <div class="rq-stat-value" style="color:${color};">${value}</div>
            <div class="rq-stat-label">${label}</div>
        </div>`;
    }

    loadingHtml() {
        return `<div style="padding:80px;text-align:center;color:#888;">
            <div style="font-size:40px;margin-bottom:12px;">⏳</div>
            <p>Loading response queue…</p>
        </div>`;
    }

    renderError(msg) {
        this.wrapper.html(`<div style="padding:60px;text-align:center;color:#C62828;">
            <div style="font-size:40px;margin-bottom:12px;">⚠️</div>
            <p>${frappe.utils.escape_html(msg)}</p>
        </div>`);
    }

    getStyles() {
        return `<style>
        .rq-wrap { max-width:1040px; margin:0 auto; padding:20px 16px 60px; font-family:var(--font-stack,Arial,sans-serif); }

        .rq-header { background:linear-gradient(135deg,#1565C0 0%,#0D47A1 100%); padding:24px 28px; border-radius:10px; margin-bottom:20px; }
        .rq-header-inner { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; }
        .rq-header h1 { margin:0 0 4px; font-size:22px; font-weight:700; color:white; }
        .rq-subtitle { margin:0; color:rgba(255,255,255,.8); font-size:13px; }
        .rq-coord-badge { background:rgba(255,255,255,.15); border:1.5px solid rgba(255,255,255,.5); color:white; padding:5px 14px; border-radius:20px; font-size:12px; font-weight:600; }

        .rq-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin-bottom:18px; }
        .rq-stat-card { background:#fff; border:1px solid #e0e0e0; border-top:3px solid #ccc; border-radius:8px; padding:14px 16px; text-align:center; }
        .rq-stat-value { font-size:28px; font-weight:800; line-height:1.2; }
        .rq-stat-label { font-size:11px; color:#666; margin-top:4px; text-transform:uppercase; letter-spacing:.5px; }

        .rq-legend { display:flex; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px; padding:10px 14px; background:#f9f9f9; border:1px solid #eee; border-radius:8px; }
        .rq-note { font-size:12px; color:#888; margin-left:auto; }

        .rq-filters { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
        .rq-filter-btn { background:#f5f5f5; border:1.5px solid #ddd; border-radius:20px; padding:6px 14px; font-size:12px; font-weight:600; color:#555; cursor:pointer; transition:all .15s; }
        .rq-filter-btn:hover { border-color:#1565C0; color:#1565C0; }
        .rq-filter-btn.active { background:#1565C0; border-color:#1565C0; color:#fff; }
        .rq-filter-count { display:inline-block; background:rgba(0,0,0,.12); border-radius:10px; padding:1px 7px; font-size:11px; margin-left:4px; }
        .rq-filter-btn.active .rq-filter-count { background:rgba(255,255,255,.25); }

        .rq-table-wrap { background:#fff; border:1px solid #e0e0e0; border-radius:10px; overflow:hidden; }
        .rq-table { width:100%; border-collapse:collapse; }
        .rq-table thead tr { background:#f9f9f9; }
        .rq-table th { padding:10px 14px; font-size:11px; color:#888; text-transform:uppercase; letter-spacing:.4px; font-weight:600; text-align:left; border-bottom:1px solid #eee; white-space:nowrap; }
        .rq-row { border-top:1px solid #eee; cursor:pointer; transition:background .12s; }
        .rq-row:hover { background:#f0f4ff; }
        .rq-table td { padding:11px 14px; font-size:13px; vertical-align:middle; }
        .td-pos { color:#bbb; font-size:12px; font-weight:600; width:36px; }
        .td-name { font-weight:600; color:#1a1a1a; }
        .td-county { color:#555; }
        .td-date { color:#444; white-space:nowrap; font-size:12px; }
        .td-score { white-space:nowrap; }
        .td-judges { white-space:nowrap; }

        .rq-coord-score { font-weight:700; font-size:15px; color:#1565C0; }
        .rq-of { font-size:11px; color:#aaa; font-weight:400; }
        .rq-unscored { color:#bbb; font-size:13px; font-style:italic; }

        .rq-badge { display:inline-block; padding:3px 10px; border-radius:12px; font-size:11px; font-weight:600; }
        .badge-none    { background:#FFF3E0; color:#E65100; }
        .badge-partial { background:#FFF8E1; color:#F9A825; }
        .badge-done    { background:#E8F5E9; color:#2E7D32; }

        .rq-empty-row { padding:40px; text-align:center; color:#aaa; font-size:14px; }
        .rq-footer { text-align:center; color:#bbb; font-size:11px; margin-top:30px; }
        </style>`;
    }
}
