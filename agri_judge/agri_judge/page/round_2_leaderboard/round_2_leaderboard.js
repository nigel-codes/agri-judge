/**
 * Round 2 Leaderboard
 * - Coordinator: all counties, per-judge breakdown (subtotal / tech bonus / leverage / total), variance warnings
 * - Judge: own county only, averaged totals only
 * - Cutoff: 60 points (out of max 110)
 */

frappe.pages['round-2-leaderboard'].on_page_load = function(wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Round 2 Leaderboard',
        single_column: true
    });
    page.add_button('Home', () => frappe.set_route('/app'), 'octicon octicon-home');
    page.add_button('Back to Dashboard', () => frappe.set_route('judge-dashboard'), 'octicon octicon-arrow-left');
    if (frappe.user_roles.includes('Coordinator')) {
        page.add_button('R2 Scoring Dashboard', () => frappe.set_route('round-2-scoring-dashboard'), 'octicon octicon-dashboard');
        page.add_button('Round 2 Finalists', () => frappe.set_route('round-2-finalists'), 'octicon octicon-trophy');
    }
    page.set_primary_action('Refresh', () => wrapper._r2lb && wrapper._r2lb.load(), 'octicon octicon-sync');
    wrapper._r2lb = new Round2Leaderboard(page, wrapper);
};

frappe.pages['round-2-leaderboard'].on_page_show = function(wrapper) {
    if (wrapper._r2lb) wrapper._r2lb.load();
};

const R2_CUTOFF = 60;

class Round2Leaderboard {
    constructor(page, wrapper) {
        this.page    = page;
        this.wrapper = $(wrapper).find('.page-content');
        this.data    = [];
        this.view    = null;
        this.county  = null;
    }

    load() {
        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.get_r2_leaderboard',
            callback: (r) => {
                if (r.message && r.message.success) {
                    this.data   = r.message.leaderboard || [];
                    this.view   = r.message.view;
                    this.county = r.message.county || null;
                    this.render();
                } else {
                    this.renderError(r.message?.error || 'Failed to load Round 2 leaderboard.');
                }
            }
        });
    }

    render() {
        const isManager  = this.view === 'coordinator';
        const rows       = this.data;
        const county     = this.county;

        const total      = rows.length;
        const passing    = rows.filter(r => r.passes_cutoff).length;
        const avgAll     = total ? (rows.reduce((s, r) => s + r.avg_total_score, 0) / total).toFixed(1) : '—';
        const topScore   = total ? Math.max(...rows.map(r => r.avg_total_score)).toFixed(1) : '—';
        const highVar    = isManager ? rows.filter(r => r.high_variance).length : 0;

        this.wrapper.html(`
            ${this.getStyles(isManager)}

            <div class="lb-wrap">

                <div class="lb-header">
                    <div class="lb-header-inner">
                        <div>
                            <h1>🏆 Round 2 Leaderboard</h1>
                            <p class="lb-subtitle">
                                ${isManager
                                    ? 'Coordinator view — all counties · per-judge breakdown · variance alerts · cut-off ${R2_CUTOFF}/110'
                                    : `Judge view — ${frappe.utils.escape_html(county || 'your county')} · cut-off ${R2_CUTOFF}/110`
                                }
                            </p>
                        </div>
                        <div class="lb-header-right">
                            <div class="view-badge ${isManager ? 'view-coord' : 'view-judge'}">
                                ${isManager ? '🎯 Coordinator' : '⚖ Judge View'}
                            </div>
                            ${isManager
                                ? `<button class="btn-export" onclick="window._r2lbExport()">⬇ Export CSV</button>`
                                : ''}
                        </div>
                    </div>
                </div>

                <div class="lb-stats">
                    <div class="stat-card">
                        <div class="stat-num">${total}</div>
                        <div class="stat-lbl">${isManager ? 'Evaluated Applicants' : 'Applicants in Your County'}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-num" style="color:#2E7D32;">${passing}</div>
                        <div class="stat-lbl">Passing Cut-off (avg ≥${R2_CUTOFF})</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-num">${avgAll}</div>
                        <div class="stat-lbl">Average Score</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-num" style="color:#ED1B2E;">${topScore}</div>
                        <div class="stat-lbl">Highest Score</div>
                    </div>
                    ${isManager && highVar > 0 ? `
                    <div class="stat-card" style="border-top-color:#E65100;">
                        <div class="stat-num" style="color:#E65100;">⚠ ${highVar}</div>
                        <div class="stat-lbl">High Variance (review needed)</div>
                    </div>` : ''}
                </div>

                <div class="lb-table-wrap">
                    ${total === 0 ? this.renderEmpty() : this.renderTable(rows, isManager)}
                </div>

                ${this.getFooter()}
            </div>
        `);

        if (isManager) {
            this.wrapper.find('.lb-row[data-idx]').on('click', function() {
                const idx    = $(this).data('idx');
                const detail = $(`#r2detail-${idx}`);
                detail.toggleClass('open');
                $(this).find('.expand-icon').text(detail.hasClass('open') ? '▲' : '▼');
            });
        }

        window._r2lbData   = rows;
        window._r2lbExport = () => this.exportCSV();
    }

    renderTable(rows, isManager) {
        const medal = (i) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;

        const headerCols = isManager
            ? `<div>Rank</div><div>Applicant</div><div>County</div><div>Avg Score</div><div>Range</div><div>Judges</div><div>Status</div><div></div>`
            : `<div>Rank</div><div>Applicant</div><div>Avg Score</div><div>Judges</div><div>Status</div>`;

        const colsTpl = isManager
            ? 'grid-template-columns:56px 1fr 110px 120px 100px 80px 130px 36px;'
            : 'grid-template-columns:56px 1fr 130px 80px 130px;';

        const rowsHtml = rows.map((r, i) => {
            const passes     = r.passes_cutoff;
            const medal_html = `<div class="rank rank-${i < 3 ? ['gold','silver','bronze'][i] : 'plain'}">${medal(i)}</div>`;

            const scoreBar = `
                <div class="score-bar-wrap">
                    <div class="score-bar-fill" style="width:${(r.avg_total_score / 110) * 100}%;background:${passes ? '#2E7D32' : '#ED1B2E'};"></div>
                    <span class="score-bar-val ${passes ? 'score-green' : ''}">${r.avg_total_score.toFixed(1)}</span>
                </div>`;

            const statusBadge = passes
                ? `<span class="badge badge-pass">✓ Passes Cut-off</span>`
                : `<span class="badge badge-fail">✗ Below Cut-off</span>`;

            if (isManager) {
                const jd     = r.judge_detail || [];
                const scores = jd.map(j => j.total_score);
                const range  = scores.length > 1
                    ? `${Math.min(...scores).toFixed(0)} – ${Math.max(...scores).toFixed(0)}`
                    : '—';
                const varWarn = r.high_variance
                    ? ' <span title="High variance — judges disagree significantly" style="color:#E65100;">⚠</span>'
                    : '';

                const detailRows = jd.map(j => `
                    <div class="detail-judge-row">
                        <div class="detail-avatar">${(j.judge_name || j.judge).charAt(0).toUpperCase()}</div>
                        <div class="detail-name">${frappe.utils.escape_html(j.judge_name || j.judge)}</div>
                        <div class="detail-scores">
                            <span class="detail-score-chip">Sub: ${j.subtotal_score.toFixed(0)}</span>
                            <span class="detail-score-chip chip-tech">Tech: +${j.tech_bonus.toFixed(0)}</span>
                            <span class="detail-score-chip chip-lev">Lev: +${j.leverage_points.toFixed(0)}</span>
                            <span class="detail-score-chip chip-total ${j.passes_cutoff ? 'chip-pass' : ''}">
                                Total: ${j.total_score.toFixed(1)}
                            </span>
                        </div>
                    </div>`).join('');

                return `
                    <div class="lb-row" data-idx="${i}" style="${colsTpl}">
                        ${medal_html}
                        <div class="app-info">
                            <div class="app-name">${frappe.utils.escape_html(r.applicant_name)}</div>
                        </div>
                        <div class="cell-text">${frappe.utils.escape_html(r.county || '—')}</div>
                        <div>${scoreBar}</div>
                        <div class="cell-text cell-muted">${range}${varWarn}</div>
                        <div class="cell-text">${r.judge_count}</div>
                        <div>${statusBadge}</div>
                        <div class="expand-icon" style="color:#bbb;font-size:11px;text-align:center;">▼</div>
                    </div>
                    <div class="lb-detail" id="r2detail-${i}">
                        <div class="detail-heading">Judge Scores</div>
                        ${detailRows || '<div style="color:#aaa;font-size:13px;">No submitted evaluations yet.</div>'}
                        ${r.high_variance ? `<div class="variance-warn">⚠ High score variance (${r.variance.toFixed(1)} points spread) — consider moderation before finalising.</div>` : ''}
                    </div>`;
            } else {
                return `
                    <div class="lb-row no-click" style="${colsTpl}">
                        ${medal_html}
                        <div class="app-info">
                            <div class="app-name">${frappe.utils.escape_html(r.applicant_name)}</div>
                        </div>
                        <div>${scoreBar}</div>
                        <div class="cell-text">${r.judge_count} judge${r.judge_count !== 1 ? 's' : ''}</div>
                        <div>${statusBadge}</div>
                    </div>`;
            }
        }).join('');

        return `
            <div class="lb-table">
                <div class="lb-table-head" style="${colsTpl}">${headerCols}</div>
                ${rowsHtml}
            </div>`;
    }

    renderEmpty() {
        return `<div class="lb-empty">
            <div style="font-size:52px;margin-bottom:16px;">📊</div>
            <strong>No evaluated Round 2 applicants yet.</strong>
            <p>Rankings will appear here once judges submit their Round 2 scores.</p>
        </div>`;
    }

    renderError(msg) {
        this.wrapper.html(`
            ${this.getStyles(false)}
            <div class="lb-wrap">
                <div style="text-align:center;padding:80px 20px;">
                    <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
                    <h3 style="color:#ED1B2E;">${frappe.utils.escape_html(msg)}</h3>
                    <button class="btn btn-primary" onclick="location.reload()">Retry</button>
                </div>
                ${this.getFooter()}
            </div>
        `);
    }

    exportCSV() {
        const rows = window._r2lbData || [];
        const lines = [
            ['Rank','Applicant','County','Avg Total Score','Judge Count','Passes Cut-off','Leverage Category']
                .join(',')
        ];
        rows.forEach((r, i) => {
            lines.push([
                i + 1,
                `"${(r.applicant_name || '').replace(/"/g, '""')}"`,
                `"${(r.county || '').replace(/"/g, '""')}"`,
                r.avg_total_score.toFixed(1),
                r.judge_count,
                r.passes_cutoff ? 'Yes' : 'No',
                `"${(r.leverage_category || '').replace(/"/g, '""')}"`,
            ].join(','));
        });
        const blob = new Blob([lines.join('\n')], {type: 'text/csv'});
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = `agri_r2_leaderboard_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
    }

    getFooter() {
        return `
            <footer class="krc-footer">
                <div class="krc-footer-inner">
                    <div class="krc-footer-brand">
                        <span class="krc-footer-cross">✚</span>
                        <span class="krc-footer-text">
                            Built by <strong>Kenya Red Cross — Digital Transformation Unit</strong>
                        </span>
                    </div>
                    <div class="krc-footer-partners">
                        In partnership with <strong>IOMe</strong> &amp; <strong>Airbus</strong>
                        &nbsp;·&nbsp; AgriWaste Innovation Challenge ${new Date().getFullYear()}
                    </div>
                </div>
            </footer>`;
    }

    getStyles(isManager) {
        return `<style>
            .lb-wrap { max-width:1260px; margin:0 auto; padding-bottom:0; min-height:calc(100vh - 60px); display:flex; flex-direction:column; font-family:Arial,sans-serif; }

            .lb-header { background:linear-gradient(135deg,#1565C0 0%,#0D47A1 100%); padding:24px 28px; border-radius:10px; margin-bottom:20px; color:white; }
            .lb-header-inner { display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; }
            .lb-header h1 { margin:0 0 6px; font-size:24px; font-weight:700; }
            .lb-subtitle { margin:0; font-size:13px; opacity:.8; }
            .lb-header-right { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
            .view-badge { padding:5px 14px; border-radius:20px; font-size:12px; font-weight:700; }
            .view-coord { background:rgba(255,255,255,.2); color:white; }
            .view-judge { background:rgba(255,255,255,.15); color:white; }
            .btn-export { background:white; color:#1565C0; border:none; padding:7px 16px; border-radius:7px; font-size:13px; font-weight:700; cursor:pointer; transition:all .15s; }
            .btn-export:hover { background:#f8f8f8; transform:scale(1.04); }

            .lb-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:14px; margin-bottom:20px; }
            .stat-card { background:white; border-radius:10px; padding:18px 20px; box-shadow:0 2px 8px rgba(0,0,0,.06); border-top:4px solid #1565C0; }
            .stat-num { font-size:30px; font-weight:800; color:#1565C0; line-height:1; margin-bottom:4px; }
            .stat-lbl { font-size:11px; color:#999; text-transform:uppercase; letter-spacing:.5px; font-weight:600; }

            .lb-table-wrap { flex:1; background:white; border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,.06); overflow:hidden; }
            .lb-table-head { display:grid; padding:12px 18px; background:linear-gradient(135deg,#1a1a1a,#333); color:white; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; }
            .lb-row { display:grid; padding:14px 18px; border-bottom:1px solid #f0f0f0; cursor:pointer; align-items:center; transition:background .15s; }
            .lb-row:hover:not(.no-click) { background:#fafafa; }
            .lb-row.no-click { cursor:default; }
            .lb-row:last-child { border-bottom:none; }

            .rank { font-size:20px; font-weight:800; display:flex; align-items:center; justify-content:center; }
            .rank-gold   { color:#FFC107; }
            .rank-silver { color:#9E9E9E; }
            .rank-bronze { color:#795548; }
            .rank-plain  { color:#555; font-size:16px; }

            .app-info { display:flex; flex-direction:column; justify-content:center; }
            .app-name { font-size:15px; font-weight:700; color:#1a1a1a; }
            .app-sub  { font-size:12px; color:#aaa; margin-top:2px; }
            .cell-text { font-size:13px; color:#555; display:flex; align-items:center; }
            .cell-muted { color:#888; }

            .score-bar-wrap { display:flex; align-items:center; gap:8px; }
            .score-bar-fill { height:8px; border-radius:4px; min-width:4px; }
            .score-bar-val { font-size:15px; font-weight:700; color:#1565C0; min-width:42px; }
            .score-green { color:#2E7D32 !important; }

            .badge { padding:4px 10px; border-radius:12px; font-size:11px; font-weight:700; white-space:nowrap; }
            .badge-pass { background:#E8F5E9; color:#2E7D32; }
            .badge-fail { background:#FFEBEE; color:#C62828; }

            .lb-detail { display:none; padding:16px 20px 18px 54px; background:#f8f8f8; border-bottom:1px solid #eee; }
            .lb-detail.open { display:block; }
            .detail-heading { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:#888; margin-bottom:10px; }
            .detail-judge-row { display:flex; align-items:center; gap:12px; margin-bottom:10px; flex-wrap:wrap; }
            .detail-avatar { width:30px; height:30px; border-radius:50%; background:#1565C0; color:white; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; flex-shrink:0; }
            .detail-name { font-size:13px; color:#333; min-width:160px; font-weight:600; }
            .detail-scores { display:flex; gap:6px; flex-wrap:wrap; }
            .detail-score-chip { padding:3px 9px; border-radius:10px; font-size:12px; font-weight:600; background:#e8eaf6; color:#3949AB; }
            .chip-tech  { background:#e3f2fd; color:#1565C0; }
            .chip-lev   { background:#f3e5f5; color:#6A1B9A; }
            .chip-total { background:#eeeeee; color:#333; font-weight:700; }
            .chip-pass  { background:#E8F5E9; color:#2E7D32; }
            .variance-warn { margin-top:12px; background:#FFF3E0; border:1px solid #FFD54F; border-radius:6px; padding:8px 12px; font-size:12px; color:#E65100; }
            .expand-icon { cursor:pointer; user-select:none; }

            .lb-empty { padding:70px 30px; text-align:center; color:#aaa; font-size:15px; }
            .lb-empty p { font-size:13px; margin-top:8px; }

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
