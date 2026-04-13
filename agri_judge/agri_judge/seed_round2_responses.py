"""
Seed script: insert test Round 2 Response records.
Run with:
  cd /home/nigel/frappe/frappe-bench
  bench --site <site> execute agri_judge.scripts.seed_round2_responses.run
"""

import frappe

TEST_RECORDS = [
    # Kakamega
    {
        "applicant_name": "Amina Wanjiku",
        "gender": "Female",
        "county": "Kakamega",
        "age": 28,
        "developmental_level": "Validation Stage (Seed; MVP developed; testing with users)",
        "is_tech_enabled": 1,
        "innovation_description": (
            "Our innovation focuses on converting agricultural waste from sugarcane "
            "processing into biochar fertiliser. We have developed a low-cost kiln that "
            "smallholder farmers can operate without technical training. Trials with 40 "
            "farmers over six months show a 25% increase in maize yields and a significant "
            "reduction in synthetic fertiliser costs. The biochar also improves water "
            "retention in sandy soils common in western Kenya. We are partnering with a "
            "local agro-dealer network to distribute the product and provide on-farm support."
        ),
        "resources_needed": (
            "We need access to a mechanical engineer to help refine the kiln design for "
            "mass production, business development support for pricing and distribution, "
            "and seed funding of approximately KES 800,000 to purchase materials for the "
            "next batch of kilns."
        ),
        "score": 8.5,
        "score_notes": "Strong MVP with measurable farmer impact. Distribution plan is credible.",
    },
    {
        "applicant_name": "Brian Ochieng",
        "gender": "Male",
        "county": "Kakamega",
        "age": 34,
        "developmental_level": "Early Traction Stage (Series A; initial revenue; product-market fit emerging)",
        "is_tech_enabled": 0,
        "innovation_description": (
            "I produce organic compost pellets from maize husks and coffee pulp collected "
            "from smallholder cooperatives in Kakamega. We currently sell 4 tonnes per "
            "month to flower farms and vegetable growers. The pellets are KEBS-certified "
            "and priced competitively against imported organic inputs. Our biggest "
            "challenge is working capital for bulk raw material purchases during the "
            "post-harvest season."
        ),
        "resources_needed": (
            "Working capital facility of KES 1.2M, a dedicated sales representative for "
            "Nairobi-based flower farms, and a pellet-packing machine to reduce "
            "labour costs."
        ),
        "score": 0.0,
        "score_notes": "",
    },
    {
        "applicant_name": "Grace Nafula",
        "gender": "Female",
        "county": "Kakamega",
        "age": 22,
        "developmental_level": "Idea / Concept Stage (Pre-seed; no product yet)",
        "is_tech_enabled": 1,
        "innovation_description": (
            "I want to build a mobile app that connects smallholder farmers with "
            "agricultural waste buyers in real time. Farmers would list the type and "
            "quantity of waste available after harvest, and buyers (composters, biogas "
            "producers) would place orders and arrange pickup. The app would include "
            "a price discovery feature based on current market rates."
        ),
        "resources_needed": (
            "A co-founder with mobile app development skills, mentorship on agri-tech "
            "business models, and a grant of KES 300,000 for a prototype and user "
            "testing phase."
        ),
    },
    # Homabay
    {
        "applicant_name": "David Otieno",
        "gender": "Male",
        "county": "Homabay",
        "age": 31,
        "developmental_level": "Growth / Scaling Stage (Series B/C; expanding operations and markets)",
        "is_tech_enabled": 1,
        "innovation_description": (
            "We operate a fish-waste biogas plant that processes offal and skins from "
            "the Lake Victoria fish processing factories. The biogas is sold to fish "
            "smokers who previously used firewood, reducing deforestation and improving "
            "air quality. We currently serve 120 smoking units and are profitable. Our "
            "digestate is sold as liquid fertiliser to local vegetable farmers. We "
            "seek to replicate the model in Kisumu and Migori."
        ),
        "resources_needed": (
            "Expansion capital of KES 5M, regulatory guidance on biogas distribution "
            "licensing, and a partnership with a county government for waste feedstock "
            "agreements at new sites."
        ),
        "score": 9.0,
        "score_notes": "Proven revenue model, clear social impact. Replication plan is realistic.",
    },
    {
        "applicant_name": "Esther Achieng",
        "gender": "Female",
        "county": "Homabay",
        "age": 26,
        "developmental_level": "Validation Stage (Seed; MVP developed; testing with users)",
        "is_tech_enabled": 0,
        "innovation_description": (
            "I produce fish-skin leather products — wallets, belts, and sandals — using "
            "discarded tilapia skins from Homabay fish processors. The skins are currently "
            "dumped in the lake. My tanning process uses natural plant extracts, making "
            "the product fully biodegradable. I have sold 200 units to tourists and "
            "online buyers in the past three months."
        ),
        "resources_needed": (
            "A tanning workshop with proper effluent management, training in export "
            "compliance and leather finishing, and a micro-loan of KES 400,000 for "
            "equipment."
        ),
        "score": 7.5,
        "score_notes": "Creative circular economy solution. Export potential is a strong differentiator.",
    },
    # Meru
    {
        "applicant_name": "Faith Mwenda",
        "gender": "Female",
        "county": "Meru",
        "age": 29,
        "developmental_level": "Early Traction Stage (Series A; initial revenue; product-market fit emerging)",
        "is_tech_enabled": 0,
        "innovation_description": (
            "We convert miraa (khat) stems and rejected leaves — a major waste stream "
            "from Meru's large miraa industry — into pressed fibreboard panels for "
            "low-cost housing construction. One tonne of miraa waste produces 80 panels "
            "sufficient for a single room. We sell panels to self-help housing groups "
            "at KES 350 per panel versus KES 900 for timber equivalent. We have "
            "completed construction of 12 demonstration rooms."
        ),
        "resources_needed": (
            "A hydraulic press machine (KES 1.8M), structural engineering certification "
            "for the panels, and a distribution agreement with a housing NGO operating "
            "in the Mount Kenya region."
        ),
        "score": 8.0,
        "score_notes": "Addresses a local waste stream no other applicant has targeted. Housing angle is compelling.",
    },
    {
        "applicant_name": "James Kirimi",
        "gender": "Male",
        "county": "Meru",
        "age": 38,
        "developmental_level": "Maturity Stage (Series D+; sustainable business; exit-ready)",
        "is_tech_enabled": 1,
        "innovation_description": (
            "Our company has operated for seven years producing macadamia shell "
            "briquettes for export to Europe as a renewable fuel. We process 60 tonnes "
            "of shells monthly from partner farms in Meru and Embu. We have ISO 9001 "
            "certification and a long-term supply contract with a Dutch importer. We "
            "are now developing a carbon credit programme to monetise our avoided "
            "emissions and seeking a strategic investor."
        ),
        "resources_needed": (
            "A carbon credit verification partner, legal support for the carbon credit "
            "contract structure, and an investor introduction to a climate-focused "
            "private equity firm."
        ),
        "score": 9.5,
        "score_notes": "Established business with export track record. Carbon credit angle adds significant upside.",
    },
    # Kericho
    {
        "applicant_name": "Peter Kiprotich",
        "gender": "Male",
        "county": "Kericho",
        "age": 25,
        "developmental_level": "Idea / Concept Stage (Pre-seed; no product yet)",
        "is_tech_enabled": 1,
        "innovation_description": (
            "Tea pruning waste in Kericho amounts to hundreds of thousands of tonnes "
            "annually and is mostly burned. I plan to develop a mobile shredding and "
            "pelletising service that visits tea estates, converts pruning waste into "
            "biomass pellets on-site, and sells them to tea factories for co-firing in "
            "their boilers. The service would be provided on a revenue-sharing basis "
            "with the estates."
        ),
        "resources_needed": (
            "A mentor with biomass energy sector experience, a feasibility study grant "
            "of KES 150,000, and introductions to two or three large tea estates willing "
            "to pilot the concept."
        ),
        "score": 6.0,
        "score_notes": "Strong market opportunity but still pre-prototype. Needs technical co-founder.",
    },
    {
        "applicant_name": "Mercy Chebet",
        "gender": "Female",
        "county": "Kericho",
        "age": 33,
        "developmental_level": "Validation Stage (Seed; MVP developed; testing with users)",
        "is_tech_enabled": 0,
        "innovation_description": (
            "I use spent tea leaves from Kericho tea factories to produce a natural "
            "fabric dye in four shades of green and brown. The dye is GOTS-certified "
            "and I have trial orders from two Nairobi fashion brands. Each kilogram of "
            "spent tea yields 200g of dry dye concentrate. I currently process 500kg "
            "of waste per month from a single factory."
        ),
        "resources_needed": (
            "A dye extraction centrifuge (KES 600,000), a food-grade packaging line "
            "for the concentrate, and market access support to reach European sustainable "
            "fashion buyers."
        ),
    },
    # Other county
    {
        "applicant_name": "Samuel Mutua",
        "gender": "Male",
        "county": "Other",
        "county_other": "Machakos",
        "age": 40,
        "developmental_level": "Growth / Scaling Stage (Series B/C; expanding operations and markets)",
        "is_tech_enabled": 1,
        "innovation_description": (
            "We aggregate sisal waste from Machakos and Kitui smallholder farmers and "
            "produce sisal fibre boards and geotextiles for road construction and "
            "erosion control. Our geotextiles are used on 14 county road projects and "
            "we have a MoU with the Kenya Rural Roads Authority. We are profitable with "
            "annual revenue of KES 22M and seek to expand into Tanzania."
        ),
        "resources_needed": (
            "Export market entry support for Tanzania, a quality certification for "
            "East African road standards, and growth equity of KES 8M for a second "
            "production line."
        ),
        "score": 8.0,
        "score_notes": "Impressive government traction. Regional expansion is credible given existing MoU.",
    },
]


def run():
    existing = {
        r.applicant_name
        for r in frappe.get_all("Round 2 Response", fields=["applicant_name"])
    }

    created = 0
    skipped = 0
    for rec in TEST_RECORDS:
        if rec["applicant_name"] in existing:
            print(f"  SKIP (exists): {rec['applicant_name']}")
            skipped += 1
            continue

        doc = frappe.new_doc("Round 2 Response")
        for k, v in rec.items():
            setattr(doc, k, v)
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        print(f"  CREATED: {doc.name}  —  {doc.applicant_name} ({doc.county})")
        created += 1

    print(f"\nDone. {created} created, {skipped} skipped.")
