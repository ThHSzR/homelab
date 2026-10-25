"""Invoke npm's PM2 script without relying on its /usr/bin/env shebang."""
import os
from pathlib import Path

PREFIX = Path(os.environ.get('PREFIX', '/data/data/com.termux/files/usr'))
PM2 = [str(PREFIX / 'bin/node'), str(PREFIX / 'lib/node_modules/pm2/bin/pm2')]
