const fetch = require('node-fetch')
const fs = require('fs')
const { DOMParser, XMLSerializer } = require('xmldom')

const ACCESS_TOKEN = process.env.ACCESS_TOKEN
const USER_NAME = process.env.USER_NAME
const HEADERS = { Authorization: 'Bearer ' + ACCESS_TOKEN }
const QUERY_COUNT = {
  userGetter: 0,
  followerGetter: 0,
  commitGetter: 0,
  repoGetter: 0,
  contributionGetter: 0,
  prGetter: 0,
  locGetter: 0,
}

const formatPlural = (unit) => (unit !== 1 ? 's' : '')

const dailyReadme = (birthday) => {
  const now = new Date()
  const diff = {
    years: now.getFullYear() - birthday.getFullYear(),
    months: now.getMonth() - birthday.getMonth(),
    days: now.getDate() - birthday.getDate(),
  }
  if (diff.days < 0) {
    diff.months -= 1
    diff.days += new Date(now.getFullYear(), now.getMonth(), 0).getDate()
  }
  if (diff.months < 0) {
    diff.years -= 1
    diff.months += 12
  }
  return `${diff.years} year${formatPlural(diff.years)}, ${
    diff.months
  } month${formatPlural(diff.months)}, ${diff.days} day${formatPlural(
    diff.days,
  )}${diff.months === 0 && diff.days === 0 ? ' 🎂' : ''}`
}

const simpleRequest = async (funcName, query, variables) => {
  QUERY_COUNT[funcName]++
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  if (res.status === 200) return res.json()
  throw new Error(`${funcName} failed: ${res.status} ${await res.text()}`)
}

const userGetter = async (username) => {
  const query = `query($login: String!){ user(login: $login) { id createdAt } }`
  const variables = { login: username }
  const data = await simpleRequest('userGetter', query, variables)
  return { id: data.data.user.id, createdAt: data.data.user.createdAt }
}

const followerGetter = async (username) => {
  const query = `query($login: String!){ user(login: $login) { followers { totalCount } } }`
  const variables = { login: username }
  const data = await simpleRequest('followerGetter', query, variables)
  return data.data.user.followers.totalCount
}

const commitGetter = async (username) => {
  const query = `
    query($login: String!){
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            totalContributions 
          }
        }
      }
    }
  `
  const variables = {
    login: username,
  }
  const data = await simpleRequest('commitGetter', query, variables)
  return data.data.user.contributionsCollection.contributionCalendar.totalContributions.toLocaleString(
    'en-US',
  )
}

const repoGetter = async (username) => {
  const query = `
    query($login: String!){
      user(login: $login) {
        repositories(ownerAffiliations: [OWNER]) {
          totalCount
        }
      }
    }
  `
  const variables = {
    login: username,
  }
  const data = await simpleRequest('repoGetter', query, variables)
  return data.data.user.repositories.totalCount
}

const contributionGetter = async (username) => {
  const query = `
    query($login: String!){
      user(login: $login) {
        repositories(ownerAffiliations: [COLLABORATOR, ORGANIZATION_MEMBER]) {
          totalCount
        }
      }
    }
  `
  const variables = {
    login: username,
  }
  const data = await simpleRequest('contributionGetter', query, variables)
  return data.data.user.repositories.totalCount
}

const prGetter = async (username) => {
  const query = `
    query($login: String!){
      user(login: $login) {
        pullRequests(first: 1) {
          totalCount
        }
      }
    }
  `

  const variables = {
    login: username,
  }
  const data = await simpleRequest('prGetter', query, variables)
  return data.data.user.pullRequests.totalCount
}

const locGetter = async (username) => {
  let totalLinesAdded = 0
  let totalLinesRemoved = 0
  let hasNextPage = true
  let endCursor = null

  // GraphQL query to fetch pull requests with pagination
  const query = `
    query($login: String!, $after: String) {
      user(login: $login) {
        pullRequests(first: 100, after: $after, states: [MERGED, OPEN, CLOSED]) {
          totalCount
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            additions
            deletions
          }
        }
      }
    }
  `

  while (hasNextPage) {
    const variables = {
      login: username,
      after: endCursor,
    }
    const data = await simpleRequest('locGetter', query, variables)
    const pullRequestsConnection = data.data.user.pullRequests

    for (const pr of pullRequestsConnection.nodes) {
      totalLinesAdded += pr.additions
      totalLinesRemoved += pr.deletions
    }

    hasNextPage = pullRequestsConnection.pageInfo.hasNextPage
    endCursor = pullRequestsConnection.pageInfo.endCursor
  }

  return {
    totalCount: (totalLinesAdded + totalLinesRemoved).toLocaleString('en-US'),
    linesAdded: totalLinesAdded.toLocaleString('en-US'),
    linesRemoved: totalLinesRemoved.toLocaleString('en-US'),
  }
}

const vsCodeGetter = async () => {
  const url = 'https://update.code.visualstudio.com/api/releases/stable'
  const res = await fetch(url)
  if (res.status === 200) {
    const data = await res.json()
    return `VSCode ${data[0]}`
  }
}

function svgOverwrite(
  filename,
  ageData,
  timeData,
  repoData,
  contribData,
  commitData,
  prData,
  locData,
  vsCodeData,
) {
  const xml = fs.readFileSync(filename, 'utf8')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const findAndReplace = (id, text) => {
    const el = doc.getElementById(id)
    if (el) el.textContent = text
  }

  findAndReplace('age_data', ageData)
  findAndReplace('time_data', timeData)
  findAndReplace('repo_data', repoData)
  findAndReplace('contrib_data', contribData)
  findAndReplace('commit_data', commitData)
  findAndReplace('pr_data', prData)
  findAndReplace('vscode_data', vsCodeData)

  findAndReplace('loc_data', locData.totalCount)
  findAndReplace('loc_add', locData.linesAdded)
  findAndReplace('loc_del', locData.linesRemoved)
  fs.writeFileSync(filename, new XMLSerializer().serializeToString(doc), 'utf8')
}

async function main() {
  const birthday = new Date(1993, 7, 19) // August 19, 1993
  const hostTime = new Date(2019, 6, 19) // July 19, 2019
  const userData = await userGetter(USER_NAME)
  const ageData = dailyReadme(birthday)
  const timeData = dailyReadme(hostTime)
  const repoData = await repoGetter(USER_NAME)
  const contribData = await contributionGetter(USER_NAME)
  const commitData = await commitGetter(USER_NAME)
  const prData = await prGetter(USER_NAME)
  const locData = await locGetter(USER_NAME)
  const vsCodeData = await vsCodeGetter()

  svgOverwrite(
    'dark_mode.svg',
    ageData,
    timeData,
    repoData,
    contribData,
    commitData,
    prData,
    locData,
    vsCodeData,
  )

  svgOverwrite(
    'light_mode.svg',
    ageData,
    timeData,
    repoData,
    contribData,
    commitData,
    prData,
    locData,
    vsCodeData,
  )

  console.log(
    'Total GitHub GraphQL API calls:',
    Object.values(QUERY_COUNT).reduce((a, b) => a + b, 0),
  )
}

main().catch(console.error)
