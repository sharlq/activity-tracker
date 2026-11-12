# Personal Activity Tracker for VS Code and Cursor

Tells your own activity tracker which workspace, language, and git branch you're working
in, while the editor is focused and you're typing or moving around. It only talks to
127.0.0.1 and never sends file names, paths, or contents.

It finds the tracker by itself through `%USERPROFILE%\.activity-tracker\api.json`, which
the tracker writes when it starts. See the main project README for installing it.
