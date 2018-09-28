> **WARNING**: we just (2018-09-23 15:40 UTC) push-forced a new history without the database in
> order to reduce the size of this repo. See [#5](https://github.com/ghuser-io/db/issues/5).

[![Build Status](https://travis-ci.org/ghuser-io/db.svg?branch=master)](https://travis-ci.org/ghuser-io/db)
[![All Contributors](https://img.shields.io/badge/all_contributors-3-orange.svg?style=flat-square)](#contributors)

[<img src="https://rawgit.com/ghuser-io/db/master/thirdparty/octicons/database.svg" align="left" width="64" height="64">](https://github.com/ghuser-io/db)

# [ghuser.io](https://github.com/ghuser-io/ghuser.io)'s database scripts

This repository provides scripts to update the database for the
[ghuser.io](https://github.com/ghuser-io/ghuser.io) Reframe app. The database consists of JSON
files. The production data is stored on
[AWS](https://github.com/ghuser-io/ghuser.io/blob/master/aws). The scripts expect it at `~/data`.
This can be changed [here](https://github.com/ghuser-io/db/blob/d3d4fd7/impl/data.js#L9).

The [fetchBot](fetchBot/) calls these scripts. It runs daily on an
[EC2 instance](https://github.com/ghuser-io/ghuser.io/blob/master/aws/ec2).

## Table of Contents

<!-- toc -->

- [Setup](#setup)
- [Usage](#usage)
- [Implementation](#implementation)
- [Contributors](#contributors)

<!-- tocstop -->

## Setup

API keys can be created [here](https://github.com/settings/developers).

```bash
$ npm install
```

## Usage

**Start tracking a user**

```bash
$ ./addUser.js USER
```

**Stop tracking a user**

```bash
$ ./rmUser.js USER "you asked us to remove your profile in https://github.com/ghuser-io/ghuser.io/issues/666"
```

**Refresh and clean data for all tracked users**

```
$ export GITHUB_CLIENT_ID=0123456789abcdef0123
$ export GITHUB_CLIENT_SECRET=0123456789abcdef0123456789abcdef01234567
$ export GITHUB_USERNAME=AurelienLourot
$ export GITHUB_PASSWORD=********
$ ./fetchAndCalculateAll.sh
GitHub API key found.
GitHub credentials found.
...
/home/ubuntu/data/users
  921 users
  largest: tarsius.json (22 KB)
  total: 2057 KB
/home/ubuntu/data/contribs
  largest: tarsius.json (113 KB)
  total: 5 MB
/home/ubuntu/data/repos
  41502 repos
  25616 significant repos
  largest: jlord/patchwork.json (708 KB)
  total: 86 MB
/home/ubuntu/data/repoCommits
  largest: CocoaPods/Specs.json (3928 KB)
  total: 211 MB
/home/ubuntu/data/orgs.json: 1900 KB
/home/ubuntu/data/nonOrgs.json: 104 KB
/home/ubuntu/data/meta.json: 48 B
total: 306 MB

=> 341 KB/user

real    150m37.837s
user    10m51.248s
sys     0m50.716s
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
                       │  │ repo*/myOwner/myRepo.json │─┐     │
                       │  └───────────────────────────┘ │─┐   │
                       │    └───────────────────────────┘ │   │
                       │      └────┬──────────────────────┘   │
                       │           │                          │
                       │           │          ┌───────────────┘
                       │           │          │
                       v           v          v
                   [ ./calculateContribsAndMeta.js ]
                           │               │
                           v               v
       ┌──────────────────────┐         ┌───────────┐
       │ contribs/myuser.json │─┐       │ meta.json │
       └──────────────────────┘ │─┐     └───────────┘
         └──────────────────────┘ │
           └──────────────────────┘
```

> **NOTES**:
>
> * These scripts also delete unreferenced data.
> * Instead of calling each of these scripts directly, you can call `./fetchAndCalculateAll.sh`
>   which will orchestrate them.

## Contributors

Thanks goes to these wonderful people ([emoji key](https://github.com/kentcdodds/all-contributors#emoji-key)):

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore -->
| [<img src="https://avatars1.githubusercontent.com/u/11795312?v=4" width="100px;"/><br /><sub><b>Aurelien Lourot</b></sub>](https://ghuser.io/AurelienLourot)<br />[💬](#question-AurelienLourot "Answering Questions") [💻](https://github.com/ghuser-io/db/commits?author=AurelienLourot "Code") [📖](https://github.com/ghuser-io/db/commits?author=AurelienLourot "Documentation") [👀](#review-AurelienLourot "Reviewed Pull Requests") | [<img src="https://avatars3.githubusercontent.com/u/4883293?v=4" width="100px;"/><br /><sub><b>Charles</b></sub>](https://github.com/wowawiwa)<br />[💻](https://github.com/ghuser-io/db/commits?author=wowawiwa "Code") [📖](https://github.com/ghuser-io/db/commits?author=wowawiwa "Documentation") [🤔](#ideas-wowawiwa "Ideas, Planning, & Feedback") | [<img src="https://avatars2.githubusercontent.com/u/1005638?v=4" width="100px;"/><br /><sub><b>Romuald Brillout</b></sub>](https://twitter.com/brillout)<br />[🤔](#ideas-brillout "Ideas, Planning, & Feedback") |
| :---: | :---: | :---: |
<!-- ALL-CONTRIBUTORS-LIST:END -->

This project follows the [all-contributors](https://github.com/kentcdodds/all-contributors) specification. Contributions of any kind welcome!
