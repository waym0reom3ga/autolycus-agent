from pathlib import Path


def test_windows_native_install_path_docs_match_installer() -> None:
    doc = Path("website/docs/user-guide/windows-native.md").read_text()
    install = Path("scripts/install.ps1").read_text()

    assert "%LOCALAPPDATA%\\lycus\\lycus-agent\\venv\\Scripts" in doc
    assert "Get-Command lycus        # should print C:\\Users\\<you>\\AppData\\Local\\lycus\\lycus-agent\\venv\\Scripts\\lycus.exe" in doc
    assert '$lycusBin = "$InstallDir\\venv\\Scripts"' in install
