import json, os, subprocess, sys, tempfile, unittest
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import atlas

DEMO = os.path.join(ROOT, "cities", "nyc-demo")

class TestAtlas(unittest.TestCase):
    def test_projection_origin_is_zero(self):
        p = atlas.Proj(40.0, -74.0)
        self.assertEqual(p(40.0, -74.0), (0.0, 0.0))
        x, y = p(39.99, -73.99)
        self.assertGreater(x, 0); self.assertGreater(y, 0)

    def test_meters(self):
        self.assertAlmostEqual(atlas.meters_ll((40.0, -74.0), (40.001, -74.0)), 110.5, delta=1)

    def test_demo_validates(self):
        errs, _ = atlas.validate(DEMO, quiet=True)
        self.assertEqual(errs, [])

    def test_exclude_terms_flag_rows(self):
        with tempfile.TemporaryDirectory() as d:
            subprocess.run(["cp", "-r", DEMO + "/.", d], check=True)
            prof = json.load(open(os.path.join(d, "profile.json"))); prof["exclude_terms"] = ["rooftop"]
            json.dump(prof, open(os.path.join(d, "profile.json"), "w"))
            errs, _ = atlas.validate(d, quiet=True)
            self.assertTrue(any("excluded term" in e for e in errs))

    def test_options_rank_and_build(self):
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "bundle.json")
            b = atlas.build(DEMO, out)
            self.assertEqual([o["rank"] for o in b["options"]], [1, 2, 3])
            costs = [o["all_in_monthly"] for o in b["options"] if not o["over_budget"]]
            self.assertEqual(costs, sorted(costs))
            for o in b["options"]:
                self.assertLessEqual(len(o["top_daily"]), 10); self.assertLessEqual(len(o["top_weekly"]), 10)
                for t in o["top_daily"]: self.assertLessEqual(t["min"], 20)
                self.assertTrue(o["routes"])
            self.assertIn("OpenStreetMap", b["attribution"])

    def test_top_places_diversity(self):
        places = [{"kind": "daily", "tag": "coffee", "lat": "40.0", "lon": "-74.0", "confidence": "likely", "layer": "Coffee"} for _ in range(5)]
        picked = atlas.top_places(places, (40.0, -74.0), {"interests": {"coffee": 1}}, "daily", per_group=2)
        self.assertEqual(len(picked), 2)

if __name__ == "__main__":
    unittest.main()
