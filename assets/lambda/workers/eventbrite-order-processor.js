import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { SESClient, SendTemplatedEmailCommand } from '@aws-sdk/client-ses'
import * as mysql2 from 'mysql2/promise'

const DB_NAME = process.env.DB_NAME
const DB_HOST = process.env.DB_HOST
const DB_PORT = process.env.DB_PORT
const SES_CONFIGSET = process.env.SES_CONFIGSET
const SES_TEMPLATE = process.env.SES_TEMPLATE
const SES_IDENTITY = process.env.SES_IDENTITY

let dbConnection
let dbCurrentUser

async function loadConfigProperty () {
  const client = new SSMClient()
  const input = { // GetParameterRequest
    Name: 'badgevent-eventbrite-config',
    WithDecryption: false
  }
  const command = new GetParameterCommand(input)
  const response = await client.send(command)
  const valueStr = response.Parameter.Value
  const value = JSON.parse(valueStr)
  // console.log('CONFIG\n' + JSON.stringify(value, null, 2))
  return value
}

async function getDbSecrets (dbUser) {
  const client = new SecretsManagerClient()
  const input = { // GetSecretValueRequest
    SecretId: `dbuser-${dbUser}`
  }
  const command = new GetSecretValueCommand(input)
  const response = await client.send(command)
  const secret = JSON.parse(response.SecretString)
  return secret
}

async function dbConnect (dbSecrets) {
  dbConnection = await mysql2.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: dbSecrets.username,
    password: dbSecrets.password,
    database: DB_NAME,
    ssl: 'Amazon RDS'
  }).catch((err) => {
    console.log(`Error connecting to database: ${err}`)
  })
  dbCurrentUser = dbSecrets.username
  console.log(`connection=${dbConnection}`)
  return dbConnection
}

async function findAvailableLogin (prefix) {
  // find an available login name
  prefix = prefix.replace(/[^a-zA-Z0-9]/g, '')
  let num = 1
  let login
  while (true) {
    login = prefix + num
    const [rows] = await dbConnection.execute(
      'SELECT `id` FROM `users` WHERE login = ?',
      [login]
    )
    console.log(`findAvailableLogin: login=${login} rows=${rows}`)
    if (rows.length === 0) {
      break
    }
    num++
  }
  return login
}

async function createUser (login, givenName, familyName, email, badgeName) {
  let member
  const result = await dbConnection.execute(
    'INSERT INTO `users` (`login`, `given_name`, `family_name`, `email`, `badge_name`) VALUES (?, ?, ?, ?, ?)',
    [login, givenName, familyName, email, badgeName]
  )
  if (result && result.length > 0 && result[0].insertId) {
    member = {
      id: result[0].insertId,
      login
    }
  }
  return member
}

async function getOrCreateMember (givenName, familyName, email, badgeName) {
  let member
  const [rows] = await dbConnection.execute(
    'SELECT `id`, `login` FROM `users` WHERE `given_name` = ? AND `family_name` = ? AND `email` = ? AND `disabled` = "no"',
    [givenName, familyName, email]
  )
  if (rows.length > 0) {
    member = rows[0]
    console.log(`FOUND EXISTING MEMBER: id=${member.id} login=${member.login}`)
  } else {
    console.log(`CREATING MEMBER: givenName=${givenName} familyName=${familyName} email=${email} badgeName=${badgeName}`)
    const login = await findAvailableLogin(givenName)
    console.log(`FOUND UNIQUE LOGIN: login=${login}`)
    member = await createUser(login, givenName, familyName, email, badgeName)
    console.log(`CREATED MEMBER: id=${member.id}`)
  }
  return member
}

async function getUserRoleByExtId (extSystemId, extOrderId, extItemId) {
  let row
  const [rows] = await dbConnection.execute(
    'SELECT * FROM `user_roles` WHERE `id_ext_system` = ? AND `id_ext_order` = ? AND `id_ext_item` = ?',
    [extSystemId, extOrderId, extItemId]
  )
  if (rows.length > 0) {
    row = rows[0]
  }
  return row
}

async function sendEventbriteRoleEmail (site, login, email, givenName, familyName, registeredDate, extEventId, extSystemId, extOrderId, extItemId) {
  // Get the event name(s) and first event id
  console.log('Looking up event settings')
  let [rows] = await dbConnection.execute(
    'SELECT `events`.`name`, `events`.`id` FROM `settings` LEFT JOIN `events` ON `settings`.`id_event` = `events`.`id` WHERE `settings`.`name` = "eventbrite_event_id" AND `settings`.`value` = ?',
    [extEventId]
  ).catch((err) => {
    console.log(`Error looking up event settings: ${err}\n${err.stack}}`)
  })
  const eventNames = rows.map(row => row.name).join(', ')
  const eventId = rows[0].id
  console.log(`Found event settings: eventNames=${eventNames} eventId=${eventId}`);
  // Get the registration email address of the first event found
  [rows] = await dbConnection.execute(
    'SELECT `value` FROM `settings` WHERE `name` = "reg_email" AND `id_event` = ?',
    [eventId]
  ).catch((err) => {
    console.log(`Error looking up Reg Email setting: ${err}\n${err.stack}`)
  })
  const regEmail = rows[0].value;
  // Get the company name
  [rows] = await dbConnection.execute(
    'SELECT `value` FROM `settings` WHERE `name` = "company" AND (`id_event` IS NULL OR `id_event` = "")',
    [eventId]
  ).catch((err) => {
    console.log(`Error looking up Company Name setting: ${err}\n${err.stack}`)
  })
  const company = rows[0].value
  console.log(`Found reg email: regEmail=${regEmail}`)
  // Send the email
  const sesClient = new SESClient()
  const input = {
    Destination: {
      ToAddresses: [email]
    },
    Source: regEmail,
    Template: SES_TEMPLATE,
    TemplateData: JSON.stringify({
      company,
      site,
      login,
      email,
      givenName,
      familyName,
      registeredDate,
      eventNames,
      extSystemId,
      extOrderId,
      extItemId
    }),
    ConfigurationSetName: SES_CONFIGSET
  }
  console.log('Sending templated email')
  const command = new SendTemplatedEmailCommand(input)
  const response = await sesClient.send(command)
  console.log(`sendEventbriteRoleEmail: result=${JSON.stringify(response, null, 2)}`)
  return response
}

async function createExtUserRole (extSystemId, extOrderId, extItemId, memberId, role, effective, expires, registeredDate) {
  const result = await dbConnection.execute(
    'INSERT INTO `user_roles` (`id_ext_system`, `id_ext_order`, `id_ext_item`, `id_user`, `role`, `effective`, `expires`, `registered_date`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [extSystemId, extOrderId, extItemId, memberId, role, effective, expires, registeredDate]
  )
  const userRoleId = result.insertId
  return userRoleId
}

async function updateUserRoleExt (extSystemId, extOrderId, extItemId, role, effective, expires, registeredDate) {
  const result = await dbConnection.execute(
    'UPDATE `user_roles` SET `role` = ?, `effective` = ?, `expires` = ?, `registered_date` = ? WHERE `id_ext_system` = ? AND `id_ext_order` = ? AND `id_ext_item` = ? LIMIT 1',
    [role, effective, expires, registeredDate, extSystemId, extOrderId, extItemId]
  )
  return result
}

async function createOrUpdateUserRoleByExtId (extSystemId, extEventId, extOrderId, extItemId, dbUser, givenName, familyName, email, role, effective, expires, registeredDate, badgeName) {
  console.log(`CREATE_OR_UPDATE_ROLE: dbUser=${dbUser} givenName=${givenName} familyName=${familyName} email=${email} role=${role} effective=${effective} expires=${expires} registeredDate=${registeredDate} badgeName=${badgeName} extOrderId=${extOrderId} extItemId=${extItemId}`)
  if (dbUser !== dbCurrentUser) {
    console.log(`Connecting to the Database: currentUser=${dbCurrentUser} => user=${dbUser}`)
    const dbSecrets = await getDbSecrets(dbUser)
    await dbConnect(dbSecrets)
  }
  const extUserRole = await getUserRoleByExtId(extSystemId, extOrderId, extItemId, registeredDate)
  if (extUserRole) {
    // check to see if the role needs to be updated
    const dbEffective = dateObjToDbDate(extUserRole.effective)
    const dbExpires = dateObjToDbDate(extUserRole.expires)
    if (extUserRole.role !== role || dbEffective !== effective || dbExpires !== expires) {
      console.log(`UPDATING ROLE: oldRole=${extUserRole.role} newRole=${role} oldEffective=${dbEffective} newEffective=${effective} oldExpires=${dbExpires} newExpires=${expires}`)
      const result = await updateUserRoleExt(extSystemId, extOrderId, extItemId, role, effective, expires, registeredDate)
      console.log(`UPDATED ROLE: ${result}`)
    } else {
      console.log(`ROLE ALREADY EXISTS: id_member=${extUserRole.id_user} role=${role} effective=${effective} expires=${expires}`)
    }
  } else {
    const member = await getOrCreateMember(givenName, familyName, email, badgeName)
    if (member) {
      console.log(`CREATING ROLE: memberId=${member.id} extOrderId=${extOrderId} extItemId=${extItemId} role=${role} effective=${effective} expires=${expires}`)
      await createExtUserRole(extSystemId, extOrderId, extItemId, member.id, role, effective, expires, registeredDate)
      const site = `https://${SES_IDENTITY}/` // TODO this is temp until we have method to get site from DB
      await sendEventbriteRoleEmail(site, member.login, email, givenName, familyName, registeredDate, extEventId, extSystemId, extOrderId, extItemId)
    }
  }
}

function dateObjToDbDate (dateObj) {
  const year = dateObj.getFullYear()
  const month = ('0' + (dateObj.getMonth() + 1)).slice(-2)
  const day = ('0' + dateObj.getDate()).slice(-2)
  return `${year}-${month}-${day}`
}

exports.handler = async function (event, context) {
  // console.log('ENVIRONMENT VARIABLES\n' + JSON.stringify(process.env, null, 2))
  console.info('EVENT\n' + JSON.stringify(event, null, 2))
  const config = await loadConfigProperty()

  for (const record of event.Records) {
    const order = JSON.parse(record.body)
    const orderId = order.id
    const eventbriteEventId = order.event_id
    const dbUser = config[eventbriteEventId].db_user
    console.log(`***** START orderId=${orderId} *****`)
    for (const attendee of order.attendees) {
      const attendeeId = attendee.id
      const createdOnStr = attendee.created // 2023-03-04T15:01:23Z
      const createdOn = new Date(createdOnStr)
      const givenName = attendee.profile.first_name
      const familyName = attendee.profile.last_name
      const email = attendee.profile.email
      const ticketClassId = attendee.ticket_class_id
      const ticketClassName = attendee.ticket_class_name
      let badgeName = ''
      let childBadgeName = ''
      for (const answer of attendee.answers) {
        if (answer.question_id === config[eventbriteEventId].question_id_badgename) {
          badgeName = answer.answer
        } else if (answer.question_id === config[eventbriteEventId].question_id_childbadgename) {
          childBadgeName = answer.answer
        }
      }
      console.log(`PROCESSING orderId=${orderId} attendeeId=${attendeeId} ticketClassName=${ticketClassName} givenName=${givenName} familyName=${familyName} email=${email} badgeName=${badgeName} childBadgeName=${childBadgeName} ticketClassId=${ticketClassId} created=${createdOn}`)

      // TODO error handling
      const ticketClass = config[eventbriteEventId].ticket_classes[ticketClassId]
      if (ticketClass) {
        if (ticketClass.role === 'child') {
          badgeName = childBadgeName
        }
        await createOrUpdateUserRoleByExtId(
          'Eventbrite',
          eventbriteEventId,
          orderId,
          attendeeId,
          dbUser,
          givenName,
          familyName,
          email,
          ticketClass.role,
          ticketClass.effective,
          ticketClass.expires,
          createdOn,
          badgeName
        ).catch((err) => {
          console.log(`ERROR: ${err}`)
        })
      }
    }
    console.log(`***** END orderId=${orderId}`)
  }
  await dbConnection.end()
  dbConnection = undefined
  dbCurrentUser = undefined
  return context.logStreamName
}
