#!/usr/bin/env python3.5

# Temporary script for issue143, taking several usernames as argument and for each:
# * calling ./addUser.js, then
# * calling ./fetchUserDetailsAndContribs.js in parallel.

# sudo pip install python-nonblock==4.0.0

import subprocess
import sys
import time

from nonblock import bgread

users=set(sys.argv[1:])
for user in users:
    subprocess.run('./addUser.js {}'.format(user), shell=True)

processes={}
for user in users:
    popen=subprocess.Popen('./fetchUserDetailsAndContribs.js {} --nospin'.format(user),
                           shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    processes[user]={
        'popen': popen,
        'stdout': bgread(popen.stdout)
    }

while True:
    time.sleep(5)
    print('----')

    all_processes_are_done=True
    for user, process in processes.items():
        def print_last_stdout_line(user, line):
            print('[{}] {}'.format(user, line))

        exitcode=process['popen'].poll()
        if exitcode != None:
            print_last_stdout_line(user, 'exited with {}'.format(exitcode))
            continue

        all_processes_are_done=False

        # we print the second-to-last line of stdout because often the very last one is
        # incomplete/unflushed:
        stdout=process['stdout'].data if process['stdout'].data else b''
        stdout=stdout.decode().split('\n')
        if len(stdout) < 2:
            stdout=['just started', '']
        print_last_stdout_line(user, stdout[-2])

    if all_processes_are_done:
        break
