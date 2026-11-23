#!/usr/bin/env python3
"""Run the automated layer of evals/cases.json and list what still needs a real-model review.

Run from the repository root: python3 evals/run_evals.py [--json]
"""
import argparse
import io
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]


def run_case(case):
    if not case['tests']:
        return {'id': case['id'], 'status': 'model_review_only', 'tests': 0, 'failures': []}
    suite = unittest.defaultTestLoader.loadTestsFromNames(case['tests'])
    result = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(suite)
    failures = [str(test) for test, _ in result.failures + result.errors]
    skipped = [str(test) for test, _ in result.skipped]
    status = 'failed' if failures else 'skipped' if skipped and len(skipped) == result.testsRun else 'passed'
    return {'id': case['id'], 'status': status, 'tests': result.testsRun, 'failures': failures, 'skipped': skipped}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--json', action='store_true', help='Print machine-readable results')
    args = parser.parse_args()
    sys.path.insert(0, str(ROOT))
    cases = json.loads((ROOT / 'evals/cases.json').read_text(encoding='utf-8'))['cases']
    results = [run_case(case) | {'title': case['title'], 'model_checks': case['model_checks']} for case in cases]
    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        labels = {'passed': '通过', 'failed': '失败', 'skipped': '跳过', 'model_review_only': '仅模型复核'}
        for item in results:
            print(f"{labels[item['status']]:<6} {item['id']:<28} {item['title']}（{item['tests']} 项测试）")
            for failure in item['failures']:
                print('       失败：' + failure)
        pending = sum(1 for item in results if item['model_checks'])
        print(f"\n自动层：{sum(item['status'] == 'passed' for item in results)} / {len(results)} 个场景通过；"
              f"{pending} 个场景另需真实模型按 model_checks 复核。")
    raise SystemExit(1 if any(item['status'] == 'failed' for item in results) else 0)


if __name__ == '__main__':
    main()
