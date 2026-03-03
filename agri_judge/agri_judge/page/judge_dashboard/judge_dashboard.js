/**
 * Judge Dashboard v6
 * Fixes: on_page_show auto-refresh, county badge, no-assignment screen
 * Added: Navigation to Leaderboard button
 */

frappe.pages['judge-dashboard'].on_page_load = function(wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: 'Judge Dashboard',
        single_column: true
    });
    page.add_button('Home', () => frappe.set_route('/app'), 'octicon octicon-home');
    page.add_button('Refresh', () => wrapper._dashboard && wrapper._dashboard.loadData(), 'refresh');
    page.add_button('View Leaderboard', () => frappe.set_route('judging-leaderboard'), 'octicon octicon-trophy', 'btn-primary');
    wrapper._dashboard = new JudgeDashboard(page);
};

// Fires every time the user navigates back to this page — keeps data fresh
frappe.pages["judge-dashboard"].on_page_show = function(wrapper) {
    // Guard: skip if this is the initial fire right after on_page_load
    if (!wrapper._dashboard) return;
    if (wrapper._dashboard) {
        wrapper._dashboard.loadData();
    }
};

class JudgeDashboard {
    constructor(page) {
        this.page           = page;
        this.wrapper        = $(this.page.body);
        this.assignedCounty = null;
        this.applications   = [];
        this.init();
    }

    init() {
        // Render skeleton immediately so the page doesn't feel blank
        this.renderSkeleton();
        this.loadData();
    }

    loadData() {
        frappe.call({
            method: 'agri_judge.agri_judge.api.judging.get_judge_assignments',
            callback: (r) => {
                if (r.message && r.message.success) {
                    this.applications   = r.message.applications || [];
                    this.assignedCounty = r.message.county;
                    this.render();
                } else {
                    this.renderNoAssignment(r.message?.error);
                }
            },
            error: () => this.renderError('Network error — could not load applications.')
        });
    }

    renderSkeleton() {
        this.wrapper.html(`
            ${this.getStyles('#ED1B2E')}
            <div class="jd-wrap">
                <div class="jd-header" style="background:linear-gradient(135deg,#ED1B2E,#C41E3A);">
                    <h1 style="margin:0;color:white;font-size:26px;">Judge Dashboard</h1>
                    <p style="margin:8px 0 0;color:rgba(255,255,255,.8);font-size:14px;">Loading your applications…</p>
                </div>
                <div style="text-align:center;padding:80px 20px;color:#aaa;font-size:15px;">
                    <div style="font-size:36px;margin-bottom:16px;">⏳</div>
                    Loading…
                </div>
                ${this.getFooter()}
            </div>
        `);
    }

    render() {
        const total     = this.applications.length;
        const completed = this.applications.filter(a => a.submitted).length;
        const pending   = total - completed;
        const pct       = total > 0 ? Math.round((completed / total) * 100) : 0;
        const county    = this.assignedCounty || 'Unassigned';

        const countyColours = {
            Kakamega: '#1565C0', Homabay: '#2E7D32',
            Kericho:  '#E65100', Meru:    '#6A1B9A', Other: '#37474F'
        };
        const cc = countyColours[county] || '#ED1B2E';

        this.wrapper.html(`
            ${this.getStyles(cc)}
            <div class="jd-wrap">

                <!-- Header -->
                <div class="jd-header">
                    <div class="jd-header-inner">
                        <div>
                            <div class="jd-title-row">
                                <h1>Judge Dashboard</h1>
                                <span class="county-chip" style="background:rgba(255,255,255,.15);border:1.5px solid rgba(255,255,255,.5);">
                                    📍 ${frappe.utils.escape_html(county)}
                                </span>
                            </div>
                            <p class="jd-subtitle">AgriWaste Innovation Challenge · You can only review applications from your assigned county</p>
                        </div>
                        <div class="jd-partner-logos">
                            <span>RedCross</span><span class="dot">·</span>
                            <span>IOMe</span><span class="dot">·</span>
                            <span>Airbus</span>
                        </div>
                    </div>
                </div>

                <!-- Stats -->
                <div class="jd-stats">
                    <div class="stat-card" style="--accent:#ED1B2E;">
                        <div class="stat-val">${total}</div>
                        <div class="stat-lbl">Assigned</div>
                    </div>
                    <div class="stat-card" style="--accent:#2E7D32;">
                        <div class="stat-val">${completed}</div>
                        <div class="stat-lbl">Completed</div>
                    </div>
                    <div class="stat-card" style="--accent:#E65100;">
                        <div class="stat-val">${pending}</div>
                        <div class="stat-lbl">Pending</div>
                    </div>
                    <div class="stat-card" style="--accent:#1565C0;">
                        <div class="stat-val">${pct}%</div>
                        <div class="stat-lbl">Progress</div>
                        <div class="stat-bar-bg">
                            <div class="stat-bar-fill" style="width:${pct}%;background:#1565C0;"></div>
                        </div>
                    </div>
                </div>

                <!-- Application cards -->
                <div class="jd-list">
                    ${total === 0
                        ? `<div class="empty-state">
                               <div style="font-size:48px;margin-bottom:16px;">📭</div>
                               <strong>No applications found for ${frappe.utils.escape_html(county)} county.</strong>
                               <p>Applications will appear here once they have been submitted to the programme.</p>
                           </div>`
                        : this.applications.map(a => this.renderCard(a, cc)).join('')
                    }
                </div>

                ${this.getFooter()}
            </div>
        `);
    }

    renderCard(app, cc) {
        const done = app.submitted;
        return `
            <div class="app-card ${done ? 'done' : ''}" style="--border:${done ? '#2E7D32' : cc};">
                <div class="card-body">
                    <div class="card-left">
                        <h3 class="card-name">${frappe.utils.escape_html(app.applicant_name || app.name)}</h3>
                        <div class="card-meta">
                            <span>🆔 ${frappe.utils.escape_html(app.name)}</span>
                            <span>📍 ${frappe.utils.escape_html(app.country || '—')}</span>
                            <span>🏷 ${frappe.utils.escape_html(app.category || '—')}</span>
                            ${app.gender === 'Female' ? '<span class="female-chip">👑 Female-led</span>' : `<span>⚥ ${frappe.utils.escape_html(app.gender || '—')}</span>`}
                        </div>
                    </div>
                    <div class="card-right">
                        <span class="status-chip ${done ? 'done' : 'pending'}">
                            ${done ? '✓ Completed' : 'Pending'}
                        </span>
                        ${done ? `<div class="score-pill">${app.final_score.toFixed(2)}<span>/10</span></div>` : ''}
                        <button class="btn-review ${done ? 'btn-done' : ''}"
                            onclick="window._openReview('${app.name}')">
                            ${done ? 'View Scores →' : 'Start Review →'}
                        </button>
                    </div>
                </div>
            </div>`;
    }

    renderNoAssignment(msg) {
        this.wrapper.html(`
            ${this.getStyles('#ED1B2E')}
            <div class="jd-wrap">
                <div class="jd-header">
                    <h1 style="color:white;margin:0;font-size:26px;">Judge Dashboard</h1>
                    <p style="color:rgba(255,255,255,.8);margin:8px 0 0;">AgriWaste Innovation Challenge</p>
                </div>
                <div class="no-assign-box">
                    <div style="font-size:52px;margin-bottom:16px;">📍</div>
                    <h2>No County Assignment Found</h2>
                    <p>${frappe.utils.escape_html(msg || 'You have not been assigned to a county.')}</p>
                    <div class="no-assign-hint">
                        <strong>What to do:</strong><br>
                        Ask your coordinator to go to<br>
                        <strong>Agri Judge → Judge County Assignment → New</strong><br>
                        and assign your user account to a county.
                    </div>
                </div>
                ${this.getFooter()}
            </div>
        `);
    }

    renderError(msg) {
        this.wrapper.html(`
            <div style="text-align:center;padding:80px 20px;">
                <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
                <h3 style="color:#ED1B2E;">${frappe.utils.escape_html(msg)}</h3>
                <button class="btn btn-primary" onclick="location.reload()">Retry</button>
            </div>
        `);
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

    getStyles(cc) {
        return `<style>
            /* ── Layout ── */
            .jd-wrap { max-width:1160px; margin:0 auto; padding-bottom:0; display:flex; flex-direction:column; min-height:calc(100vh - 60px); }

            /* ── Header ── */
            .jd-header { background:linear-gradient(135deg,#ED1B2E 0%,#C41E3A 100%); padding:26px 30px; border-radius:10px; margin-bottom:22px; }
            .jd-header-inner { display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; }
            .jd-title-row { display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-bottom:6px; }
            .jd-title-row h1 { margin:0; color:white; font-size:26px; font-weight:700; font-family:Arial,sans-serif; }
            .jd-subtitle { margin:0; color:rgba(255,255,255,.8); font-size:13px; font-family:Arial,sans-serif; }
            .county-chip { color:white; padding:5px 14px; border-radius:20px; font-size:13px; font-weight:600; font-family:Arial,sans-serif; }
            .jd-partner-logos { color:rgba(255,255,255,.7); font-size:13px; font-family:Arial,sans-serif; display:flex; align-items:center; gap:4px; }
            .dot { opacity:.4; }

            /* ── Stats ── */
            .jd-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:14px; margin-bottom:22px; }
            .stat-card { background:white; border-radius:10px; padding:20px 22px; box-shadow:0 2px 8px rgba(0,0,0,.06); border-top:4px solid var(--accent,#ED1B2E); font-family:Arial,sans-serif; }
            .stat-val { font-size:34px; font-weight:800; color:var(--accent,#ED1B2E); line-height:1; margin-bottom:4px; }
            .stat-lbl { font-size:12px; color:#888; text-transform:uppercase; letter-spacing:.5px; font-weight:600; }
            .stat-bar-bg { height:4px; background:#f0f0f0; border-radius:2px; margin-top:10px; overflow:hidden; }
            .stat-bar-fill { height:100%; border-radius:2px; transition:width .6s ease; }

            /* ── Cards ── */
            .jd-list { flex:1; }
            .app-card { background:white; border-radius:10px; margin-bottom:12px; box-shadow:0 2px 8px rgba(0,0,0,.06); border-left:4px solid var(--border,#ED1B2E); transition:transform .18s,box-shadow .18s; }
            .app-card:hover { transform:translateY(-2px); box-shadow:0 5px 18px rgba(0,0,0,.1); }
            .card-body { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; padding:18px 20px; }
            .card-left { flex:1; }
            .card-name { margin:0 0 8px; font-size:17px; font-weight:700; color:#1a1a1a; font-family:Arial,sans-serif; }
            .card-meta { display:flex; flex-wrap:wrap; gap:12px; font-size:13px; color:#777; font-family:Arial,sans-serif; }
            .female-chip { background:#FFF8E1; color:#E65100; border-radius:10px; padding:1px 8px; font-size:12px; font-weight:600; }
            .card-right { display:flex; flex-direction:column; align-items:flex-end; gap:8px; flex-shrink:0; }
            .status-chip { display:inline-block; padding:4px 12px; border-radius:12px; font-size:12px; font-weight:700; font-family:Arial,sans-serif; }
            .status-chip.done    { background:#E8F5E9; color:#2E7D32; }
            .status-chip.pending { background:#FFF3E0; color:#E65100; }
            .score-pill { font-size:22px; font-weight:800; color:#2E7D32; font-family:Arial,sans-serif; }
            .score-pill span { font-size:13px; opacity:.6; }
            .btn-review { background:#ED1B2E; color:white; border:none; padding:9px 18px; border-radius:7px; font-size:13px; font-weight:700; cursor:pointer; font-family:Arial,sans-serif; transition:background .15s,transform .15s; }
            .btn-review:hover { background:#C41E3A; transform:scale(1.04); }
            .btn-review.btn-done { background:#546E7A; }
            .btn-review.btn-done:hover { background:#37474F; }

            /* ── No assignment ── */
            .no-assign-box { background:white; border-radius:12px; padding:56px 40px; text-align:center; box-shadow:0 2px 8px rgba(0,0,0,.08); margin:8px 0 24px; font-family:Arial,sans-serif; }
            .no-assign-box h2 { color:#ED1B2E; margin:0 0 12px; font-size:22px; }
            .no-assign-box p { color:#666; max-width:440px; margin:0 auto 24px; line-height:1.7; font-size:14px; }
            .no-assign-hint { background:#FFF8E1; border:1px solid #FFD54F; border-radius:8px; padding:14px 18px; max-width:440px; margin:0 auto; text-align:left; font-size:13px; color:#555; line-height:1.7; }

            /* ── Empty state ── */
            .empty-state { background:white; border-radius:10px; padding:60px 30px; text-align:center; color:#aaa; font-family:Arial,sans-serif; font-size:15px; }
            .empty-state p { font-size:13px; margin-top:8px; }

            /* ── Footer ── */
            .krc-footer { margin-top:40px; border-top:2px solid #f0f0f0; padding:18px 0 24px; font-family:Arial,sans-serif; }
            .krc-footer-inner { display:flex; flex-direction:column; align-items:center; gap:6px; text-align:center; }
            .krc-footer-brand { display:flex; align-items:center; gap:10px; font-size:13px; color:#555; }
            .krc-footer-cross { font-size:20px; color:#ED1B2E; font-weight:900; }
            .krc-footer-text strong { color:#ED1B2E; }
            .krc-footer-partners { font-size:12px; color:#aaa; }
            .krc-footer-partners strong { color:#777; }
        </style>`;
    }
}

window._openReview = function(name) {
    frappe.set_route('judge-review', name);
};
