#!/usr/bin/env python3
"""
EVOCK - Test Runner for Milestone A5
Runs tests using the macOS JavaScriptCore engine (osascript JXA).
"""

import os
import subprocess
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMA_JS = os.path.join(BASE_DIR, "extension", "src", "extraction", "schema.js")
PROMPT_JS = os.path.join(BASE_DIR, "extension", "src", "extraction", "prompt.js")
TEST_JS = os.path.join(BASE_DIR, "tests", "extraction-schema.test.js")

with open(SCHEMA_JS, "r", encoding="utf-8") as f:
    schema_code = f.read().replace("export ", "")

with open(PROMPT_JS, "r", encoding="utf-8") as f:
    prompt_code = f.read().replace("export ", "")

with open(TEST_JS, "r", encoding="utf-8") as f:
    test_code = f.read().replace("export ", "")

jxa_script = f"""
{schema_code}
{prompt_code}
{test_code}

const results = runTests(validateAndNormalizeExtraction, EXTRACTION_SYSTEM_PROMPT, stripMarkdownFences);
JSON.stringify(results);
"""

try:
    proc = subprocess.run(
        ["osascript", "-l", "JavaScript", "-e", jxa_script],
        capture_output=True,
        text=True,
        check=True
    )
    import json
    results = json.loads(proc.stdout.strip())
    
    passed_count = sum(1 for r in results if r["passed"])
    failed_count = sum(1 for r in results if not r["passed"])
    
    print("=" * 60)
    print(f"EVOCK Milestone A5 - Test Suite Results ({len(results)} tests)")
    print("=" * 60)
    
    for r in results:
        status_icon = "✓ PASS" if r["passed"] else "✕ FAIL"
        print(f"{status_icon}: {r['name']}")
        if not r["passed"]:
            print(f"   Error: {r.get('error')}")
            
    print("-" * 60)
    print(f"Summary: {passed_count} passed, {failed_count} failed")
    print("=" * 60)
    
    if failed_count > 0:
        sys.exit(1)
        
except subprocess.CalledProcessError as e:
    print("Failed to run tests via JavaScriptCore engine:")
    print("STDERR:", e.stderr)
    print("STDOUT:", e.stdout)
    sys.exit(e.returncode)
