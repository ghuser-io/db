#!/usr/bin/env python3.5

# Temporary script for issue143, taking several usernames as argument and for each:
# * calling ./addUser.js, then
# * calling ./fetchUserDetailsAndContribs.js in parallel, then
# * calling ./fetchRepos.js --firsttime
#
# sudo pip3 install python-nonblock==4.0.0
#
# Note: a machine with 2 GB can fetch up to 43 users in parallel.

import subprocess
import sys
import time

from nonblock import bgread

users = set(sys.argv[1:])
for user in users:
    subprocess.run('./addUser.js {}'.format(user), shell=True)

processes = {}
for user in users:
    popen = subprocess.Popen('./fetchUserDetailsAndContribs.js {} --nospin'.format(user),
                             shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    processes[user] = {
        'popen': popen,
        'stdout': bgread(popen.stdout),
        'exitcode': None,
    }

while True:
    time.sleep(5)
    print('----')

    all_processes_are_done = True
    for user, process in processes.items():
        def print_last_stdout_line(user, line):
            print('[{}] {}'.format(user, line))

        exitcode = process['popen'].poll()
        if exitcode != None:
            print_last_stdout_line(user, 'exited with {}'.format(exitcode))
            process['exitcode'] = exitcode
            continue

        all_processes_are_done = False

        # we print the second-to-last line of stdout because often the very last one is
        # incomplete/unflushed:
        stdout = process['stdout'].data if process['stdout'].data else b''
        stdout = stdout.decode().split('\n')
        if len(stdout) < 2:
            stdout = ['just started', '']
        print_last_stdout_line(user, stdout[-2])

    if all_processes_are_done:
        break

for user, process in processes.items():
    exitcode = process['exitcode']
    if exitcode != 0:
        print('----')
        errmsg = '{} failed with {}'.format(user, exitcode)
        print('{}:'.format(errmsg))
        print(process['stdout'].data.decode())
        raise ChildProcessError(errmsg)

subprocess.run('./fetchRepos.js --firsttime'.format(user), shell=True)
