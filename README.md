[![Build Status](https://travis-ci.org/ghuser-io/db.svg?branch=master)](https://travis-ci.org/ghuser-io/db)

# [ghuser.io](https://github.com/ghuser-io/ghuser.io)'s database

This repository:
* Serves as database for the [ghuser.io](https://github.com/ghuser-io/ghuser.io) Reframe app.\
The DB consists of the [JSON files in `data`](data/).
* Provides scripts to update the database. 

In particular, [FetchBot](fetchBot/) runs daily on an [EC2 instance](https://github.com/ghuser-io/ghuser.io/blob/master/aws/ec2).

## Table of Contents

<!-- toc -->

- [Setup](#setup)
- [Usage](#usage)
- [Implementation](#implementation)

<!-- tocstop -->

## Setup

API keys can be created [here](https://github.com/settings/developers).

```bash
$ npm install
```

## Usage

**Start tracking a user**

`./addUser.js USER` 

**Stop tracking a user**
`./rmUser.js USER "you asked us to remove your profile in https://github.com/ghuser-io/ghuser.io/issues/666"`

**Refresh and clean data for all tracked users**

```
$ export GITHUB_CLIENT_ID=0123456789abcdef0123
$ export GITHUB_CLIENT_SECRET=0123456789abcdef0123456789abcdef01234567
$ export GITHUB_USERNAME=AurelienLourot
$ export GITHUB_PASSWORD=********
$ ./fetchAndCalculateAll.sh
...
data/
  users/
    262 users
    largest: moul.json (20 KB)
    total: 634 KB
  contribs/
    largest: moul.json (216 KB)
    total: 3823 KB
  repos/
    8159 repos
    largest: jlord/patchwork.json (379 KB)
    total: 23889 KB
  orgs.json: 639 KB
  nonOrgs.json: 35 KB
  total: 28984 KB

=> 111 KB/user
GitHub API key found.
GitHub credentials found.

real    78m44.200s
user    2m58.520s
sys     0m23.160s
```
 
## Implementation

Several scripts form a pipeline for updating the database. Here is the data flow:

```
[ ./addUser.js myUser ]   [ ./rmUser.js myUser ]
                 │             │
                 v             v
              ┌───────────────────┐
              │ users/myuser.json │<───────────┐
              └────────────────┬──┘ │─┐        │
                └──────────────│────┘ │        │                    ╔════════╗
                  └────┬───────│──────┘        │                    ║ GitHub ║
                       │       │               │                    ╚════╤═══╝
                       │       v               │                         │
                       │   [ ./fetchUserDetailsAndContribs.js myUser ]<──┤
                       │                                                 │
                       ├───────────────────────>[ ./fetchOrgs.js ]<──────┤
                       │                              ^     │            │
                       │                              │     │            │
                       │                              v     v            │
                       │                 ┌──────────────┐ ┌───────────┐  │
                       │                 │ nonOrgs.json │ │ orgs.json │  │
                       │                 └──────────────┘ └───┬───────┘  │
                       │                                      │          │
                       ├──>[ ./fetchRepos.js ]<──────────────────────────┘
                       │             │                        │
                       │             v                        │
                       │  ┌───────────────────────────┐       │
                       │  │ repos/myOwner/myRepo.json │─┐     │
                       │  └───────────────────────────┘ │─┐   │
                       │    └───────────────────────────┘ │   │
                       │      └────┬──────────────────────┘   │
                       │           │                          │
                       │           │      ┌───────────────────┘
                       │           │      │
                       v           v      v
                   [ ./calculateContribs.js ]
                                 │
                                 v
                      ┌──────────────────────┐
                      │ contribs/myuser.json │─┐
                      └──────────────────────┘ │─┐
                        └──────────────────────┘ │
                          └──────────────────────┘
```
