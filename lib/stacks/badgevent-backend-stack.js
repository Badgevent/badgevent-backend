const { Stack } = require('aws-cdk-lib')
const ApiV2Service = require('../constructs/api-v2-service')

class BadgeventBackendStack extends Stack {
  /**
   *
   * @param {Construct} scope
   * @param {string} id
   * @param {StackProps=} props
   */
  constructor (scope, id, props) {
    super(scope, id, props);
    (() => new ApiV2Service.ApiV2Service(this, 'APIV2'))()
  }
}

module.exports = { BadgeventBackendStack }
