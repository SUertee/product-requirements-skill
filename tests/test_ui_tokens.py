"""Style guard: every built-in page draws colour, type size and radius from the ui.css tokens."""
from pathlib import Path
import re
import unittest

ASSETS = Path(__file__).resolve().parents[1] / 'product-requirements/assets'
COLOUR = re.compile(r'#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(')
FONT_SIZE = re.compile(r'font-size\s*:\s*([^;}]+)')
RADIUS = re.compile(r'border-radius\s*:\s*([^;}]+)')
VARIABLE = re.compile(r'var\(\s*(--[a-z0-9-]+)')


def token_block():
    text = (ASSETS / 'ui.css').read_text(encoding='utf-8')
    start = text.index(':root {')
    end = text.index('\n}\n', start) + 3
    return text[start:end], text[:start] + text[end:]


def styled_sources():
    _, rest = token_block()
    yield 'ui.css', rest
    yield 'workbench.css', (ASSETS / 'workbench.css').read_text(encoding='utf-8')
    for name in ('prototype-shell.html', 'prototype-template.html'):
        page = (ASSETS / name).read_text(encoding='utf-8')
        yield name, '\n'.join(re.findall(r'<style[^>]*>(.*?)</style>', page, flags=re.S)).replace('__PROTOTYPE_STYLE__', '')


class UiTokenTests(unittest.TestCase):
    def test_tokens_are_defined_once_in_ui_css(self):
        block, _ = token_block()
        names = re.findall(r'(--ui-[a-z0-9-]+)\s*:', block)
        self.assertEqual(len(names), len(set(names)))
        for name, text in styled_sources():
            with self.subTest(file=name):
                self.assertNotRegex(text, r'(?m)^\s*:root\b', 'Define tokens only in the ui.css token block')

    def test_styles_use_tokens_for_colour_type_and_radius(self):
        for name, text in styled_sources():
            lines = text.splitlines()
            for number, line in enumerate(lines, 1):
                with self.subTest(file=name, line=number):
                    self.assertIsNone(COLOUR.search(line), f'{name}:{number} uses a literal colour: {line.strip()[:120]}')
                    for value in FONT_SIZE.findall(line):
                        self.assertRegex(value.strip(), r'^(var\(--ui-text-(xs|sm|md|lg|xl)\)|inherit)$', f'{name}:{number}')
                    for value in RADIUS.findall(line):
                        self.assertRegex(value.strip(), r'^(var\(--ui-radius(-sm|-pill)?\)|0|50%)$', f'{name}:{number}')

    def test_every_variable_used_is_defined(self):
        block, _ = token_block()
        defined = set(re.findall(r'(--ui-[a-z0-9-]+)\s*:', block))
        for name, text in styled_sources():
            with self.subTest(file=name):
                self.assertEqual(set(VARIABLE.findall(text)) - defined, set())


if __name__ == '__main__':
    unittest.main()
