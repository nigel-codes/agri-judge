/**
 * Judging Leaderboard v6
 * - System Manager: all counties, per-judge breakdown, variance warnings
 * - Judge: own county only, averages only, always visible (shows pending count)
 * - Navigation: Back to Dashboard button
 * - on_page_show auto-refresh
 * - KRC footer
 */

frappe.pages['judging-leaderboard'].on_page_load = function(wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Judging Leaderboard',
        single_column: true
    });
    page.add_button('Home', () => frappe.set_route('/app'), 'octicon octicon-home');
    page.add_button('Back to Dashboard', () => frappe.set_route('judge-dashboard'), 'octicon octicon-arrow-left');
    if (frappe.user_roles.includes('Coordinator')) {
        page.add_button('Advanced Metrics', () => frappe.set_route('judging-advanced-metrics'), 'octicon octicon-graph');
    }
    page.set_primary_action('Refresh', () => wrapper._lb && wrapper._lb.load(), 'octicon octicon-sync');
    wrapper._lb = new JudgingLeaderboard(page, wrapper);
};

frappe.pages['judging-leaderboard'].on_page_show = function(wrapper) {
    if (wrapper._lb) wrapper._lb.load();
};

class JudgingLeaderboard {
    constructor(page, wrapper) {
        this.page    = page;
        this.wrapper = $(wrapper).find('.page-content');
        this.data    = [];
        this.view    = null;     // 'coordinator' or 'judge'
        this.county  = null;
    }

    load() {
        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.get_leaderboard',
            callback: (r) => {
                if (r.message && r.message.success) {
                    this.data   = r.message.leaderboard || [];
                    this.view   = r.message.view;
                    this.county = r.message.county || null;
                    this.myPending = r.message.my_pending_count || 0;
                    this.myCompleted = r.message.my_completed_count || 0;
                    this.render();
                } else {
                    this.renderError(r.message?.error || 'Failed to load leaderboard.');
                }
            }
        });
    }

    render() {
        const isManager = this.view === 'coordinator';
        const rows      = this.data;
        const county    = this.county;

        // Summary stats
        const total      = rows.length;
        const shortlisted = rows.filter(r => r.avg_score >= 7).length;
        const avgAll     = total ? (rows.reduce((s, r) => s + r.avg_score, 0) / total).toFixed(2) : '—';
        const topScore   = total ? Math.max(...rows.map(r => r.avg_score)).toFixed(2) : '—';
        const highVar    = isManager ? rows.filter(r => r.high_variance).length : 0;

        this.wrapper.html(`
            ${this.getStyles(isManager)}

            <div class="lb-wrap">

                <!-- Header -->
                <div class="lb-header">
                    <div class="lb-header-inner">
                        <div>
                            <h1>🏆 Judging Leaderboard</h1>
                            <p class="lb-subtitle">
                                ${isManager
                                    ? 'Coordinator view — all counties · per-judge breakdown · variance alerts'
                                    : `Judge view — ${frappe.utils.escape_html(county || 'your county')} · ${this.myPending > 0 ? `⏳ ${this.myPending} pending evaluation${this.myPending !== 1 ? 's' : ''} · ` : ''}${this.myCompleted} complete`
                                }
                            </p>
                        </div>
                        <div class="lb-header-right">
                            <div class="view-badge ${isManager ? 'view-coord' : 'view-judge'}">
                                ${isManager ? '🎯 Coordinator' : '⚖ Judge View'}
                            </div>
                            ${isManager
                                ? `<button class="btn-export" onclick="window._lbExport()">⬇ Export CSV</button>`
                                : ''}
                        </div>
                    </div>
                </div>

                <!-- Stats -->
                <div class="lb-stats">
                    <div class="stat-card">
                        <div class="stat-num">${total}</div>
                        <div class="stat-lbl">${isManager ? 'Evaluated Applications' : 'Applications in Your County'}</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-num" style="color:#2E7D32;">${shortlisted}</div>
                        <div class="stat-lbl">Shortlisted (avg ≥7.0)</div>
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

                <!-- Table -->
                <div class="lb-table-wrap">
                    ${total === 0 ? this.renderEmpty() : this.renderTable(rows, isManager)}
                </div>

                ${this.getFooter()}
            </div>
        `);

        // Wire up row expand (coordinator only)
        if (isManager) {
            this.wrapper.find('.lb-row[data-idx]').on('click', function() {
                const idx    = $(this).data('idx');
                const detail = $(`#detail-${idx}`);
                detail.toggleClass('open');
                $(this).find('.expand-icon').text(detail.hasClass('open') ? '▲' : '▼');
            });
        }

        // Store data for CSV export
        window._lbData   = rows;
        window._lbExport = () => this.exportCSV();
    }

    renderTable(rows, isManager) {
        const medal = (i) => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;

        const headerCols = isManager
            ? `<div>Rank</div><div>Applicant</div><div>County</div><div>Avg Score</div><div>Range</div><div>Judges</div><div>Status</div><div></div>`
            : `<div>Rank</div><div>Applicant</div><div>Avg Score</div><div>Judges</div><div>Status</div>`;

        const colsTpl = isManager
            ? 'grid-template-columns:56px 1fr 110px 110px 90px 80px 120px 36px;'
            : 'grid-template-columns:56px 1fr 110px 80px 120px;';

        const rowsHtml = rows.map((r, i) => {
            const isShortlisted = r.avg_score >= 7;
            const medal_html    = `<div class="rank rank-${i < 3 ? ['gold','silver','bronze'][i] : 'plain'}">${medal(i)}</div>`;

            const scoreBar = `
                <div class="score-bar-wrap">
                    <div class="score-bar-fill" style="width:${(r.avg_score/10)*100}%;background:${isShortlisted ? '#2E7D32' : '#ED1B2E'};"></div>
                    <span class="score-bar-val ${isShortlisted ? 'score-green' : ''}">${r.avg_score.toFixed(2)}</span>
                </div>`;

            const statusBadge = isShortlisted
                ? `<span class="badge badge-short">✓ Shortlisted</span>`
                : r.avg_score >= 5
                    ? `<span class="badge badge-border">Borderline</span>`
                    : `<span class="badge badge-below">Below Threshold</span>`;

            if (isManager) {
                const range    = r.judge_count > 1 ? `${Math.min(...r.judge_detail.map(j=>j.final_score)).toFixed(1)} – ${Math.max(...r.judge_detail.map(j=>j.final_score)).toFixed(1)}` : '—';
                const varWarn  = r.high_variance ? ' <span title="High variance — judges disagree significantly" style="color:#E65100;">⚠</span>' : '';

                const detailRows = (r.judge_detail || []).map(j => `
                    <div class="detail-judge-row">
                        <div class="detail-avatar">${(j.judge_name || j.judge).charAt(0).toUpperCase()}</div>
                        <div class="detail-name">${frappe.utils.escape_html(j.judge_name || j.judge)}</div>
                        <div class="detail-score-bar">
                            <div class="score-bar-wrap" style="max-width:180px;">
                                <div class="score-bar-fill" style="width:${(j.final_score/10)*100}%;background:#1565C0;"></div>
                                <span class="score-bar-val" style="color:#1565C0;">${j.final_score.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>`).join('');

                return `
                    <div class="lb-row" data-idx="${i}" style="${colsTpl}">
                        ${medal_html}
                        <div class="app-info">
                            <div class="app-name">${frappe.utils.escape_html(r.applicant_name)}</div>
                            <div class="app-sub">${frappe.utils.escape_html(r.gender || '')}${r.category ? ' · ' + frappe.utils.escape_html(r.category) : ''}</div>
                        </div>
                        <div class="cell-text">${frappe.utils.escape_html(r.county || '—')}</div>
                        <div>${scoreBar}</div>
                        <div class="cell-text cell-muted">${range}${varWarn}</div>
                        <div class="cell-text">${r.judge_count}</div>
                        <div>${statusBadge}</div>
                        <div class="expand-icon" style="color:#bbb;font-size:11px;text-align:center;">▼</div>
                    </div>
                    <div class="lb-detail" id="detail-${i}">
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
                            <div class="app-sub">${frappe.utils.escape_html(r.gender || '')}${r.category ? ' · ' + frappe.utils.escape_html(r.category) : ''}</div>
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
            <strong>No evaluated applications yet.</strong>
            <p>Rankings will appear here once judges start submitting their scores.</p>
        </div>`;
    }

    renderLocked(msg) {
        this.wrapper.html(`
            ${this.getStyles(false)}
            <div class="lb-wrap">
                <div class="lb-header">
                    <h1 style="color:white;margin:0;font-size:24px;">🏆 Judging Leaderboard</h1>
                </div>
                <div class="lb-locked">
                    <div style="font-size:52px;margin-bottom:18px;">🔒</div>
                    <h2>Leaderboard Locked</h2>
                    <p>${frappe.utils.escape_html(msg)}</p>
                    <div class="locked-hint">Complete all your evaluations on the Judge Dashboard to unlock the leaderboard for your county.</div>
                    <button class="btn btn-primary" onclick="frappe.set_route('judge-dashboard')" style="margin-top:20px;">
                        Go to My Dashboard →
                    </button>
                </div>
                ${this.getFooter()}
            </div>
        `);
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
        const rows = window._lbData || [];
        const lines = [
            ['Rank','Applicant','County','Gender','Category','Avg Score','Judge Count','Status']
                .join(',')
        ];
        rows.forEach((r, i) => {
            const status = r.avg_score >= 7 ? 'Shortlisted' : r.avg_score >= 5 ? 'Borderline' : 'Below';
            lines.push([
                i + 1,
                `"${(r.applicant_name||'').replace(/"/g,'""')}"`,
                `"${(r.county||'').replace(/"/g,'""')}"`,
                `"${(r.gender||'').replace(/"/g,'""')}"`,
                `"${(r.category||'').replace(/"/g,'""')}"`,
                r.avg_score.toFixed(2),
                r.judge_count,
                status,
            ].join(','));
        });
        const blob = new Blob([lines.join('\n')], {type:'text/csv'});
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = `agri_innovation_leaderboard_${new Date().toISOString().slice(0,10)}.csv`;
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

            /* Header */
            .lb-header { background:linear-gradient(135deg,#ED1B2E 0%,#8B0000 100%); padding:24px 28px; border-radius:10px; margin-bottom:20px; color:white; }
            .lb-header-inner { display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; }
            .lb-header h1 { margin:0 0 6px; font-size:24px; font-weight:700; }
            .lb-subtitle { margin:0; font-size:13px; opacity:.8; }
            .lb-header-right { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
            .view-badge { padding:5px 14px; border-radius:20px; font-size:12px; font-weight:700; }
            .view-coord { background:rgba(255,255,255,.2); color:white; }
            .view-judge { background:rgba(255,255,255,.15); color:white; }
            .btn-export { background:white; color:#ED1B2E; border:none; padding:7px 16px; border-radius:7px; font-size:13px; font-weight:700; cursor:pointer; transition:all .15s; }
            .btn-export:hover { background:#f8f8f8; transform:scale(1.04); }

            /* Stats */
            .lb-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:14px; margin-bottom:20px; }
            .stat-card { background:white; border-radius:10px; padding:18px 20px; box-shadow:0 2px 8px rgba(0,0,0,.06); border-top:4px solid #ED1B2E; }
            .stat-num { font-size:30px; font-weight:800; color:#ED1B2E; line-height:1; margin-bottom:4px; }
            .stat-lbl { font-size:11px; color:#999; text-transform:uppercase; letter-spacing:.5px; font-weight:600; }

            /* Table */
            .lb-table-wrap { flex:1; background:white; border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,.06); overflow:hidden; }
            .lb-table { }
            .lb-table-head { display:grid; padding:12px 18px; background:linear-gradient(135deg,#1a1a1a,#333); color:white; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; }
            .lb-row { display:grid; padding:14px 18px; border-bottom:1px solid #f0f0f0; cursor:pointer; align-items:center; transition:background .15s; }
            .lb-row:hover:not(.no-click) { background:#fafafa; }
            .lb-row.no-click { cursor:default; }
            .lb-row:last-child { border-bottom:none; }

            /* Rank medals */
            .rank { font-size:20px; font-weight:800; display:flex; align-items:center; justify-content:center; }
            .rank-gold   { color:#FFC107; }
            .rank-silver { color:#9E9E9E; }
            .rank-bronze { color:#795548; }
            .rank-plain  { color:#555; font-size:16px; }

            /* App info */
            .app-info { display:flex; flex-direction:column; justify-content:center; }
            .app-name { font-size:15px; font-weight:700; color:#1a1a1a; }
            .app-sub  { font-size:12px; color:#aaa; margin-top:2px; }
            .cell-text { font-size:13px; color:#555; display:flex; align-items:center; }
            .cell-muted { color:#888; }

            /* Score bar */
            .score-bar-wrap { display:flex; align-items:center; gap:8px; }
            .score-bar-fill { height:8px; border-radius:4px; min-width:4px; }
            .score-bar-val { font-size:15px; font-weight:700; color:#ED1B2E; min-width:38px; }
            .score-green { color:#2E7D32 !important; }

            /* Badges */
            .badge { padding:4px 10px; border-radius:12px; font-size:11px; font-weight:700; white-space:nowrap; }
            .badge-short  { background:#E8F5E9; color:#2E7D32; }
            .badge-border { background:#FFF3E0; color:#E65100; }
            .badge-below  { background:#FFEBEE; color:#C62828; }

            /* Detail expansion (coordinator) */
            .lb-detail { display:none; padding:16px 20px 18px 54px; background:#f8f8f8; border-bottom:1px solid #eee; }
            .lb-detail.open { display:block; }
            .detail-heading { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; color:#888; margin-bottom:10px; }
            .detail-judge-row { display:flex; align-items:center; gap:12px; margin-bottom:8px; }
            .detail-avatar { width:30px; height:30px; border-radius:50%; background:#ED1B2E; color:white; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; flex-shrink:0; }
            .detail-name { font-size:13px; color:#333; min-width:160px; font-weight:600; }
            .detail-score-bar { flex:1; }
            .variance-warn { margin-top:12px; background:#FFF3E0; border:1px solid #FFD54F; border-radius:6px; padding:8px 12px; font-size:12px; color:#E65100; }

            /* Expand icon */
            .expand-icon { cursor:pointer; user-select:none; }

            /* Locked */
            .lb-locked { background:white; border-radius:12px; padding:56px 40px; text-align:center; box-shadow:0 2px 8px rgba(0,0,0,.07); margin:8px 0 24px; }
            .lb-locked h2 { color:#ED1B2E; margin:0 0 12px; font-size:22px; }
            .lb-locked p { color:#555; max-width:460px; margin:0 auto 18px; font-size:14px; line-height:1.7; }
            .locked-hint { background:#FFF8E1; border:1px solid #FFD54F; border-radius:8px; padding:13px 18px; max-width:420px; margin:0 auto; font-size:13px; color:#555; line-height:1.7; }

            /* Empty */
            .lb-empty { padding:70px 30px; text-align:center; color:#aaa; font-size:15px; }
            .lb-empty p { font-size:13px; margin-top:8px; }

            /* Footer */
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
