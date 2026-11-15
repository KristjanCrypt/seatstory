#!/usr/bin/env python3
"""Kolmefaasiline töövoog: Codex plaanib -> DeepSeek teostab -> Codex kontrollib.

Miks nii: viga enne tööd on odav, pärast tööd kallis. Plaan on ühtlasi
vastuvõtukriteeriumide nimekiri, mille vastu review käib — nii ei hinnata
"üldise maitse" järgi ja DeepSeek ei pea asju ümber tegema.

Kasutus:
    python3 orchestrator.py "ülesanne" --plan-only     # 1. faas: teeb PLAN.md, seisab
    python3 orchestrator.py "ülesanne" --from-plan     # 2. faas: teostus + review

Faasid:
  PLAN      Codex (read-only) kirjutab PLAN.md -> sina kinnitad Telegramis
  IMPLEMENT DeepSeek (hermes-test profiil) teeb plaani järgi
  REVIEW    Codex kontrollib iga vastuvõtukriteeriumi vastu, JSON-verdict
            fail -> vigade nimekiri läheb DeepSeekile, kordub (max --rounds)
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime

WORKDIR = os.path.dirname(os.path.abspath(__file__))
SCHEMA = os.path.join(WORKDIR, "review_schema.json")
PLAN = os.path.join(WORKDIR, "PLAN.md")
LOG = os.path.join(WORKDIR, "workflow_run.log")
RESULT = os.path.join(WORKDIR, "workflow_result.json")
HERMES = shutil.which("hermes-test") or "hermes-test"
CODEX = shutil.which("codex") or "codex"


def log(msg):
    line = f"[{datetime.now():%H:%M:%S}] {msg}"
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def run(cmd, timeout, label):
    log(f"-> {label}")
    t0 = time.time()
    try:
        p = subprocess.run(cmd, cwd=WORKDIR, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        log(f"!! {label} timeout {timeout}s")
        return None, f"timeout after {timeout}s"
    log(f"<- {label} valmis {time.time() - t0:.0f}s, exit={p.returncode}")
    if p.returncode != 0:
        log(f"!! {label} stderr: {(p.stderr or '')[-600:].strip()}")
    return p, p.stderr


# ---------------------------------------------------------------- 1. PLAN
def make_plan(task):
    prompt = (
        "You are the PLANNER, not the implementer. Do NOT write product code.\n\n"
        f"TASK:\n{task}\n\n"
        "Look at the current directory (read-only) to see what already exists, then write a plan "
        "in Estonian with exactly these sections, max 45 lines total:\n"
        "## Eesmärk  (1-2 lauset)\n"
        "## Nõuded  (numbered, each independently testable)\n"
        "## Failid  (which file(s) will be created/changed)\n"
        "## Sammud  (implementation order)\n"
        "## Vastuvõtukriteeriumid  (concrete checks the reviewer will run, incl. the exact "
        "example calculation and expected output, edge cases, mobile checks if relevant)\n"
        "## Piirid  (what must NOT be done: no frameworks, no extra files, etc.)\n\n"
        "Be specific and cheap: this plan is the contract for both the implementer and the reviewer."
    )
    out_file = os.path.join(WORKDIR, "plan_out.md")
    if os.path.exists(out_file):
        os.remove(out_file)
    cmd = [CODEX, "exec", "-C", WORKDIR, "-s", "read-only", "-o", out_file, prompt]
    p, err = run(cmd, timeout=600, label="Codex plan")
    if not os.path.exists(out_file):
        log("Plaani ei tekkinud")
        return None
    text = open(out_file, encoding="utf-8").read().strip()
    if not text:
        log("Plaan oli tühi")
        return None
    with open(PLAN, "w", encoding="utf-8") as f:
        f.write(text + "\n")
    log(f"PLAN.md kirjutatud ({len(text)} märki)")
    return text


# ----------------------------------------------------------- 2. IMPLEMENT
def implement(task, plan, feedback=None, timeout=1800):
    prompt = (
        f"ÜLESANNE:\n{task}\n\n"
        f"KINNITATUD PLAAN (tee täpselt selle järgi):\n{plan}\n\n"
        "Kirjuta/paranda failid kohapeal. Ära loo uut projekti teise nimega."
    )
    if feedback:
        prompt += (
            "\n\nCODECI KONTROLLI MITTELÄBITUD PUNKTID, mis TULEB ära parandada:\n"
            + "\n".join(f"- {x}" for x in feedback)
        )
    p, err = run([HERMES, "-z", prompt, "--in", WORKDIR], timeout=timeout, label="DeepSeek implement")
    if p is None:
        return False
    return p.returncode == 0


# -------------------------------------------------------------- 3. REVIEW
def review(plan, files):
    prompt = (
        "You are the REVIEWER. Do not rewrite code.\n\n"
        f"PLAN / ACCEPTANCE CRITERIA:\n{plan}\n\n"
        f"FILES: {', '.join(files)}\n\n"
        "Verify EVERY acceptance criterion in the plan, one by one, by actually inspecting and "
        "running what you can (cat, grep, node --check, python3, node -e). Do not trust comments "
        "or claims. Also check HTML/JS syntax and that no external dependencies were added.\n"
        "Return the verdict JSON per the schema. issues[] = only criteria that failed, each "
        "phrased as an actionable fix for the implementer."
    )
    out_file = os.path.join(WORKDIR, "review_out.json")
    if os.path.exists(out_file):
        os.remove(out_file)
    cmd = [CODEX, "exec", "-C", WORKDIR, "-s", "read-only",
           "--output-schema", SCHEMA, "-o", out_file, prompt]
    p, err = run(cmd, timeout=900, label="Codex review")
    if not os.path.exists(out_file):
        return None
    try:
        return json.loads(open(out_file, encoding="utf-8").read())
    except json.JSONDecodeError:
        return {"verdict": "fail", "summary": "reviewer output was not valid JSON",
                "issues": ["Reviewer returned unparsable output; rerun review."]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("task")
    ap.add_argument("--plan-only", action="store_true")
    ap.add_argument("--from-plan", action="store_true")
    ap.add_argument("--review-only", action="store_true", help="jätka teostus vahele, ainult Codexi kontroll")
    ap.add_argument("--impl-timeout", type=int, default=1800)
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--files", default="index.html")
    args = ap.parse_args()
    files = [f.strip() for f in args.files.split(",") if f.strip()]

    open(LOG, "w", encoding="utf-8").close()

    # --- faas 1: plaan
    if args.plan_only or not (args.from_plan or os.path.exists(PLAN)):
        plan = make_plan(args.task)
        if plan is None:
            print(json.dumps({"outcome": "plan_failed"}, indent=2))
            return 1
        print(plan)
        print(f"\nPLAN valmis: {PLAN}")
        print("Kinnita plaan ja käivita teostus: --from-plan")
        return 0

    # --- faas 2: teostus + review
    plan = open(PLAN, encoding="utf-8").read()

    if args.review_only:
        log("=== REVIEW-ONLY ===")
        rev = review(plan, files)
        out = {"outcome": "pass" if (rev or {}).get("verdict") == "pass" else "fail",
               "last_review": rev}
        with open(RESULT, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=2, ensure_ascii=False)
        log(f"REVIEW: {out['outcome']}")
        print(json.dumps(out, indent=2, ensure_ascii=False))
        return 0 if out["outcome"] == "pass" else 1

    history, final = [], {"task": args.task, "outcome": "unknown"}
    feedback = None
    for rnd in range(1, args.rounds + 1):
        log(f"=== RING {rnd}/{args.rounds} ===")
        ok = implement(args.task, plan, feedback, timeout=args.impl_timeout)
        entry = {"round": rnd, "implement_ok": ok}
        history.append(entry)
        if not ok:
            feedback = ["Eelmine teostus ebaõnnestus — proovi uuesti."]
            continue
        rev = review(plan, files)
        entry["review"] = rev
        if not rev:
            feedback = ["Reviewer produced no output; resubmit."]
            continue
        log(f"Codex verdict: {rev.get('verdict')} — {rev.get('summary')}")
        if rev.get("verdict") == "pass":
            final["outcome"] = "pass"
            final["passed_round"] = rnd
            break
        feedback = rev.get("issues") or ["Reviewer failed without listing issues."]
        log(f"Parandusülesanne: {len(feedback)} punkti")
    else:
        final["outcome"] = "max_rounds_reached"

    final["rounds"] = history
    with open(RESULT, "w", encoding="utf-8") as f:
        json.dump(final, f, indent=2, ensure_ascii=False)
    log(f"TULEMUS: {final['outcome']} (ring {final.get('passed_round', '-')})")
    print(json.dumps({"outcome": final["outcome"], "passed_round": final.get("passed_round"),
                      "last_review": (history[-1].get("review") if history else None)},
                     indent=2, ensure_ascii=False))
    return 0 if final["outcome"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
