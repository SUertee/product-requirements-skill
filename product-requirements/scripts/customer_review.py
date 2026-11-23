"""Serve customer questionnaires separately from the internal workbench."""
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import secrets
import tempfile
from urllib.parse import parse_qs, urlsplit

from ingest_material import ingest


def validate_questions(project, questions):
    if not isinstance(questions, list) or not 1 <= len(questions) <= 20:
        raise ValueError('请选择 1 到 20 个复核问题。')
    targets = {item['requirement_id'] for item in project['requirements']}
    result = []
    for question in questions:
        target = question.get('target') if isinstance(question, dict) else None
        if not isinstance(target, str) or target not in targets:
            raise ValueError('复核问题必须关联当前版本的需求。')
        prompt, options = question.get('prompt'), question.get('options')
        if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 300:
            raise ValueError('问题须包含 1 到 300 个字符。')
        if not isinstance(options, list) or not 2 <= len(options) <= 6 or any(
            not isinstance(option, str) or not 1 <= len(option.strip()) <= 200 for option in options
        ):
            raise ValueError('每题须有 2 到 6 个候选项，每项最多 200 字。')
        options = [option.strip() for option in options]
        if len(set(options)) != len(options):
            raise ValueError('同一题的候选项不能重复。')
        result.append({'target': target, 'prompt': prompt.strip(), 'options': options})
    return result


def page(title, body):
    return f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{escape(title)}</title>
<style>
body{{font:16px/1.6 system-ui,sans-serif;background:#f4f6fa;color:#16243b;max-width:680px;margin:2rem auto;padding:0 1rem}}
fieldset{{background:white;border:1px solid #c8d3e2;border-radius:8px;margin:1rem 0;padding:1rem}}
legend{{font-weight:700}}label{{display:block;margin:.45rem 0}}textarea{{width:100%;box-sizing:border-box;font:inherit}}
button{{background:#184d97;color:white;border:0;border-radius:6px;padding:.65rem 1rem;font:inherit;cursor:pointer}}
</style><main><h1>{escape(title)}</h1>{body}</main></html>"""


def questionnaire(document):
    sections = []
    for index, question in enumerate(document['questions']):
        options = [*question['options'], '都不合适，我来补充', '暂时无法决定']
        choices = ''.join(
            f'<label><input type="radio" name="answer-{index}" value="{choice}" required> {escape(label)}</label>'
            for choice, label in enumerate(options)
        )
        sections.append(f'<fieldset><legend>{escape(question["prompt"])}</legend>{choices}'
                        f'<label>补充说明<textarea name="note-{index}" maxlength="1000" rows="2"></textarea></label></fieldset>')
    submission = secrets.token_urlsafe(12)
    return page('客户复核', f'<p>版本 {escape(document["artifact_version"])}</p>'
                '<p>选择一项并按需补充。选择「都不合适」时请写下你的建议。</p>'
                f'<form method="post"><input type="hidden" name="submission" value="{submission}">'
                f'<label>称呼（选填）<input name="respondent" maxlength="100"></label>{"".join(sections)}<button>提交反馈</button></form>')


def record_feedback(document, form, workspace):
    submission = form.get('submission', [''])[0]
    respondent = form.get('respondent', [''])[0].strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{16}', submission) or len(respondent) > 100:
        raise ValueError('请重新打开问卷，称呼最多 100 字。')
    lines = [f'客户复核反馈。评审版本：{document["artifact_version"]}。问卷：{document["id"]}。']
    if respondent:
        lines.append(f'客户称呼：{respondent}')
    for index, question in enumerate(document['questions']):
        options = [*question['options'], '都不合适，我来补充', '暂时无法决定']
        answer = form.get(f'answer-{index}', [])
        note = form.get(f'note-{index}', [''])[0].strip()
        if len(answer) != 1 or answer[0] not in {str(i) for i in range(len(options))} or len(note) > 1000:
            raise ValueError('请为每题选择一个答案，补充说明最多 1000 字。')
        choice = int(answer[0])
        if choice == len(question['options']) and not note:
            raise ValueError('选择「都不合适」时，请补充你的建议。')
        lines.extend(['', f'需求 {question["target"]}。问题：{question["prompt"]}', f'客户选择：{options[choice]}'])
        if note:
            lines.append(f'客户补充：{note}')
    with tempfile.TemporaryDirectory(dir=workspace) as temporary:
        file = Path(temporary) / '客户复核反馈.txt'
        file.write_text('\n'.join(lines) + '\n', encoding='utf-8')
        job = ingest(file, workspace, document['project_id'], {
            'provider': 'customer_review', 'questionnaire_id': document['id'],
            'artifact_version': document['artifact_version'], 'submission_id': submission,
        })
    if job['status'] == 'failed':
        raise ValueError('反馈预处理失败，请联系负责人。')
    return job


class CustomerReviewServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, workspace):
        self.workspace = workspace
        self.directory = workspace / 'customer-questionnaires'
        self.directory.mkdir(parents=True, exist_ok=True)
        super().__init__(address, CustomerReviewHandler)

    def publish(self, project, questions):
        questions = validate_questions(project, questions)
        identifier = secrets.token_urlsafe(24)
        document = {'id': identifier, 'project_id': project['project_id'],
                    'artifact_version': project['artifact_version'], 'questions': questions}
        with (self.directory / f'{identifier}.json').open('x', encoding='utf-8') as file:
            json.dump(document, file, ensure_ascii=False)
        host, port = self.server_address
        return f'http://{host}:{port}/review/{identifier}'


class CustomerReviewHandler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, *args):
        pass

    def respond(self, body, status=200):
        content = body.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.end_headers()
        self.wfile.write(content)

    def document(self):
        match = re.fullmatch(r'/review/([A-Za-z0-9_-]{32})', urlsplit(self.path).path)
        if match:
            try:
                return json.loads((self.server.directory / f'{match[1]}.json').read_text(encoding='utf-8'))
            except FileNotFoundError:
                pass
        self.respond(page('问卷未找到', '<p>请向会议负责人确认链接。</p>'), 404)
        return None

    def do_GET(self):
        document = self.document()
        if document:
            self.respond(questionnaire(document))

    def do_POST(self):
        document = self.document()
        if not document:
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 256 * 1024:
                raise ValueError('反馈为空或过长。')
            form = parse_qs(self.rfile.read(length).decode('utf-8'), max_num_fields=42)
            record_feedback(document, form, self.server.workspace)
        except ValueError as error:
            self.respond(page('无法提交反馈', f'<p>{escape(str(error))}</p><p>请返回问卷修改后重试。</p>'), 400)
        except OSError:
            self.respond(page('无法保存反馈', '<p>请联系会议负责人后重试。</p>'), 503)
        else:
            self.respond(page('反馈已提交', '<p>你的回答已送达会议负责人。</p>'))
