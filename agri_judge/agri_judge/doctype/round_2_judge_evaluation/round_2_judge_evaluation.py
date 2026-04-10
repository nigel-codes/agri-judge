import frappe
from frappe.model.document import Document

# Rubric: score 0-5 per criterion, multiplied to get points
CRITERIA_META = [
    {"id": "c1", "name": "Novelty & Innovation",            "multiplier": 5, "max_points": 25},
    {"id": "c2", "name": "Alignment with Agri Waste Focus", "multiplier": 3, "max_points": 15},
    {"id": "c3", "name": "Developmental Level & Traction",  "multiplier": 4, "max_points": 20},
    {"id": "c4", "name": "Market Potential & Scalability",  "multiplier": 3, "max_points": 15},
    {"id": "c5", "name": "Resource & Skill Needs",          "multiplier": 2, "max_points": 10},
    {"id": "c6", "name": "Quality of Description",          "multiplier": 3, "max_points": 15},
]

# Tech bonus: score 0-3 → points 0/2/3/5
TECH_BONUS_MAP = {0: 0, 1: 2, 2: 3, 3: 5}

# Leverage points by Round 1 performance (only if subtotal >= 40)
LEVERAGE_POINTS = {
    "Top Shortlisted": 10,
    "Above Threshold":  5,
    "At Threshold":     2,
    "None":             0,
}

CUTOFF = 60
MIN_SCORE_FOR_LEVERAGE = 40


class Round2JudgeEvaluation(Document):

    def validate(self):
        self._pull_leverage_from_r2_applicant()
        self._pull_female_from_application()
        self._compute_scores()

    def on_submit(self):
        self._pull_leverage_from_r2_applicant()
        self._pull_female_from_application()
        self._compute_scores()

    def _pull_leverage_from_r2_applicant(self):
        """Copy leverage_category from the Round 2 Applicant record."""
        if not self.r2_applicant:
            return
        cat = frappe.db.get_value(
            "Round 2 Applicant", self.r2_applicant, "leverage_category"
        )
        self.leverage_category = cat or "None"

    def _pull_female_from_application(self):
        """Auto-set female_applicant from the linked Agri Waste Innovation gender field."""
        if not self.r2_applicant:
            return
        app_name = frappe.db.get_value(
            "Round 2 Applicant", self.r2_applicant, "application"
        )
        if not app_name:
            return
        gender = frappe.db.get_value("Agri Waste Innovation", app_name, "gender") or ""
        self.female_applicant = 1 if gender.lower() in ("female", "f") else 0

    def _compute_scores(self):
        meta_by_id = {c["id"]: c for c in CRITERIA_META}
        subtotal = 0.0

        for row in self.criteria:
            meta = meta_by_id.get(row.criterion_id, {})
            if meta:
                row.criterion_name = meta["name"]
                row.multiplier     = float(meta["multiplier"])
                row.max_points     = meta["max_points"]
            score = max(0, min(5, int(row.score or 0)))
            row.score         = score
            row.points_earned = round(score * float(row.multiplier or 0), 2)
            subtotal += row.points_earned

        self.subtotal_score = round(subtotal, 2)

        tech = max(0, min(3, int(self.tech_score or 0)))
        self.tech_score        = str(tech)
        self.tech_bonus_points = float(TECH_BONUS_MAP.get(tech, 0))

        leverage = 0.0
        if subtotal >= MIN_SCORE_FOR_LEVERAGE:
            leverage += float(LEVERAGE_POINTS.get(self.leverage_category or "None", 0))
            if self.female_applicant:
                leverage += 5.0
        self.leverage_points = leverage

        self.total_score  = round(subtotal + self.tech_bonus_points + leverage, 2)
        self.passes_cutoff = 1 if self.total_score >= CUTOFF else 0
