import frappe
from frappe.model.document import Document

CRITERIA_META = {
    "technical":      {"name": "Technical Capabilities",       "weight": 0.25},
    "innovativeness": {"name": "Innovativeness",               "weight": 0.25},
    "scalability":    {"name": "Scalability & Viability",      "weight": 0.20},
    "impact":         {"name": "Impact & Sustainability",      "weight": 0.20},
    "presentation":   {"name": "Completeness & Presentation",  "weight": 0.10},
}

class JudgeEvaluation(Document):

    def validate(self):
        self._compute_scores()

    def on_submit(self):
        self._compute_scores()
        # Disabled: self._update_application_summary()
        # Leaderboard calculates averages dynamically instead

    def _compute_scores(self):
        total = 0.0
        for row in self.criteria:
            meta = CRITERIA_META.get(row.criterion_id, {})
            weight = meta.get("weight", row.weight or 0)
            row.weight = weight
            row.criterion_name = meta.get("name", row.criterion_name)
            score = float(row.score or 0)
            # Presentation criterion max raw score is 1.0, others 10
            if row.criterion_id == "presentation":
                # score already 0-1, weight 0.10 → max contribution 0.10
                row.weighted_score = round(score * weight, 4)
            else:
                # score 1-10, weight → max contribution = weight * 10 / 10 = weight
                row.weighted_score = round((score / 10) * weight * 10, 4)
            total += row.weighted_score

        self.total_weighted_score = round(total, 2)
        bonus = 1.0 if self.female_led_bonus else 0.0
        self.final_score = round(min(self.total_weighted_score + bonus, 10.0), 2)
        self.shortlisted = 1 if self.final_score >= 7.0 else 0

    def _update_application_summary(self):
        """
        Update application summary - DISABLED
        
        This method was trying to update fields on Agri Waste Innovation
        that don't exist (average_judge_score, evaluations_completed, judging_status).
        
        The leaderboard API calculates averages dynamically instead,
        so this function is not needed.
        """
        pass  # Do nothing