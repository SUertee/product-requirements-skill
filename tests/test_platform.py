"""Cross-platform behaviour that cannot be exercised on the CI host directly."""
import os
from pathlib import Path
import sys
import types
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'product-requirements/scripts'))
import feishu_connector
import workflow


class _Dword:
    def __init__(self):
        self.value = 0


def fake_ctypes(kernel32, last_error=0):
    wintypes = types.SimpleNamespace(DWORD=_Dword)
    module = types.SimpleNamespace(WinDLL=lambda name, use_last_error=True: kernel32, get_last_error=lambda: last_error,
                                   byref=lambda value: types.SimpleNamespace(_obj=value), wintypes=wintypes)
    return {'ctypes': module, 'ctypes.wintypes': wintypes}


class ProcessAliveTests(unittest.TestCase):
    def test_current_process_is_alive_and_unknown_ids_are_not(self):
        self.assertTrue(workflow.process_alive(os.getpid()))
        self.assertFalse(workflow.process_alive(None))
        self.assertFalse(workflow.process_alive(0))

    def test_windows_queries_the_kernel_and_never_signals(self):
        calls = []

        class Kernel32:
            def OpenProcess(self, access, inherit, pid):
                calls.append(('open', access, pid)); return 42

            def GetExitCodeProcess(self, handle, pointer):
                pointer._obj.value = 259; return 1  # STILL_ACTIVE

            def CloseHandle(self, handle):
                calls.append(('close', handle)); return 1

            def TerminateProcess(self, *args):
                raise AssertionError('must not terminate')

        with mock.patch.object(workflow.os, 'name', 'nt'), mock.patch.dict(sys.modules, fake_ctypes(Kernel32())), \
                mock.patch.object(workflow.os, 'kill', side_effect=AssertionError('os.kill terminates processes on Windows')):
            self.assertTrue(workflow.process_alive(1234))
        self.assertEqual(calls, [('open', 0x1000, 1234), ('close', 42)])

    def test_windows_reports_access_denied_process_as_alive(self):
        class Kernel32:
            def OpenProcess(self, *args): return 0
        with mock.patch.object(workflow.os, 'name', 'nt'), mock.patch.dict(sys.modules, fake_ctypes(Kernel32(), last_error=5)):
            self.assertTrue(workflow.process_alive(1234))


class LarkCliLookupTests(unittest.TestCase):
    def test_uses_the_resolved_path_so_windows_cmd_shims_run(self):
        with mock.patch.object(feishu_connector.shutil, 'which', return_value=r'C:\Users\me\AppData\Roaming\npm\lark-cli.CMD'):
            self.assertTrue(feishu_connector.lark_cli().endswith('lark-cli.CMD'))
        with mock.patch.object(feishu_connector.shutil, 'which', return_value=None):
            self.assertEqual(feishu_connector.lark_cli(), 'lark-cli')


if __name__ == '__main__':
    unittest.main()
