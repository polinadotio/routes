const _ = require('lodash')
const cheerio = require('cheerio')
const markdownTable = require('markdown-table')

const turndown = require('../../turndown')

const REQUIRED_REGEXP = /^\*\*Required\*\*\. /
const CAN_BE_ONE_OF_REGEXP = /Can be one of/
const EITHER_REGEXP = /^Either (`[a-z]+`)/

module.exports = {
  is (el) {
    return cheerio(el).is('table')
  },
  parse (el) {
    const $el = cheerio(el)

    if (isParametersTable($el)) {
      return {
        type: 'parameters',
        params: toParams($el)
      }
    }

    return {
      type: 'description',
      text: toData($el)
    }
  }
}

/**
 * Identify parameters table by table head that looks like this
 * <thead>
 *   <tr>
 *     <th>Name</th>
 *     <th>Type</th>
 *     <th>Description</th>
 *   </tr>
 * </thead>
 */
function isParametersTable ($table) {
  return $table.find('thead').text().replace(/\s/g, '') === 'NameTypeDescription'
}

function toParams ($table) {
  return $table
    .find('tbody tr')
    .map(rowToParameter)
    .get()
}

function rowToParameter (i, el) {
  const [name, type, {description, defaultValue, enumValues, isRequired}] = cheerio(el)
    .children()
    .map((i, el) => {
      if (i < 2) { // first two columns are simply name and type
        return cheerio(el).text().trim()
      }

      const text = turndown(cheerio(el).html().trim())
      const hasDefault = /\bDefault: /.test(text)
      let description = turndown(cheerio(el).html())
      let defaultValue

      if (hasDefault) {
        let [, _defaultValue, afterDefaultDescription = ''] = text.match(/\bDefault: `([^`]+)`\.?\s*(.*)/) || []

        defaultValue = _defaultValue || (text.match(/\bDefault: (.*)$/) || []).pop()

        // if description after the default value continues with a lowercase letter
        // it is likely directly related to it, e.g.
        //  > Default: true when environment is production and false otherwise.
        // https://developer.github.com/v3/repos/deployments/#create-a-deployment
        if (/^[a-z]/.test(afterDefaultDescription)) {
          const [defaultDescription, ...rest] = afterDefaultDescription.split(/\.[\s\n]/)
          afterDefaultDescription = rest.join('. ')
          defaultValue = `\`${defaultValue}\` ${defaultDescription.replace(/\.$/, '')}`
        }
        description = [
          description.replace(/\bDefault: .*$/, '').trim(),
          afterDefaultDescription
        ].filter(Boolean).join(' ')
      }
      const isRequired = REQUIRED_REGEXP.test(description)

      if (isRequired) {
        description = description.replace(REQUIRED_REGEXP, '')
      }

      let enumValues
      if (CAN_BE_ONE_OF_REGEXP.test(description)) {
        enumValues = _.uniq(description.match(/`([^`]+)`/g).map(s => s.replace(/`/g, '')))
      } else if (EITHER_REGEXP.test(description)) {
        // Include only words that begin and end with backticks (ignore all others)
        enumValues = description.replace(/[,.]/g, '').split(' ').filter((term) => term[0] === '`' && term[term.length - 1] === '`').map((term) => term.substring(1, term.length - 1))
      }
      return {
        description,
        defaultValue,
        enumValues,
        isRequired
      }
    })
    .get()

  const params = {
    name,
    type: type.toLowerCase(),
    description,
    default: defaultValue,
    required: isRequired
  }

  if (params.name === 'comments') {
    params.type = 'objects[]'
  }

  if (enumValues && params.type !== 'boolean') {
    params.type = 'enum'
    params.options = enumValues
  }

  // 'true' / 'false' => true / false
  if (params.type === 'boolean' && ['true', 'false'].includes(defaultValue)) {
    params.default = defaultValue === 'true'
  }

  return _.omitBy(params, _.isUndefined)
}

function toData ($table) {
  const data = []
  $table
    .find('tr')
    .each((i, el) => {
      const values = cheerio(el)
        .find('td, th')
        .map((i, el) => turndown(cheerio(el).html()))
        .get()
      data.push(values)
    })
    .get()

  return markdownTable(data)
}
