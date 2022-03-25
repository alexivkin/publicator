# Static site publisher

Turn any dynamic website (especially wordpress) into a fast, secure, stable static site

1. Reduced complexity - no need to run simply static plugin. No need to preview
2. Better control - you can now configure redirects to fix problematic URLs right there.
3. Better security - only select people can publish the site. Only a set of people can preview not-yet-published contents.
4. Scheduled publishing

## Features

* Google Firebase for static site hosting/publishing, with local preview using Google's SuperStatic webserver.
* Google OAUTH for authentication
* Custom publishing to CloudFront or a folder via custom server-side commands. For example you can run post processing code by including the following in config.json;
`"code":"sed -i 's|<loc>/|<loc>https://site.com/|;s|<image:loc><!\\[CDATA\\[/|<image:loc><!\\[CDATA\\[https://site.com/|' /sitemaps/*.xml; rsync -av --checksum --delete /static/ /public/"`,
See the end of controller.js for more details,

## Setup

* Create a `config.json` configuration file. The sample is in `config.sample.json`
* Create OAuth credentials with https://server.io/callback URL, enable People API.
* Create a firebase hosting project and tie it to GCP
* Create a firebase [service account](https://console.cloud.google.com/iam-admin/serviceaccounts) in the IAM/Service accounts page on GCP (firebase is tied to GCP through the "blaze" subscription)
* Click on the firebase admin service account actions then create key. and save the contents of the downloaded json into the config.json as a `"firebase":{ ... }` object

### Running locally

* Build with `docker build -t publicator .`
* Make sure the OAuth creds include the http://localhost:8080/callback call-back URL
* Run:

`docker run --rm -it -e DEBUG=publicator:* -v $PWD/config.json:/root/.config/configstore/publicator.json:ro -v $PWD/superstatic/firebase.json:/publicator/superstatic/firebase.json -v $PWD/superstatic/firebase.schema.json:/publicator/superstatic/firebase.schema.json -v $PWD/superstatic/scraper.schema.json:/publicator/superstatic/scraper.schema.json -p 8080:8080 -p 3474:3474  alexivkin/publicator

### Running in Kubernetes

See [this file](KUBERNETES.md)

### Running natively

1. Install NodeJS 14.4+
2. Run `npm install`
3. Register the app with the Google OAuth (see the "setup" section)
4. Create the configuration file `.config/configstore/publicator.json`
5. Now run it as `node server.js`

## Using

* Login to the publisher
* First click "generate" to create static copy of wordpress
* If you want, click "preview" to check the result. Once you are comfortable with the result then click "publish" to make it public.
* To schedule the whole process at a different time use the "date time picker form" or enter date/time manually and click "schedule publishing". The static site generation and publishing of the site will be done at that date. You can close your browser.

## References

* Node Scheduler
    * https://www.npmjs.com/package/node-schedule
* Date/time wiget and human-readable processor
    * https://gijgo.com/datetimepicker
    * https://momentjs.com/
* JSON Editor
    * Testing schema - https://pmk65.github.io/jedemov2/dist/demo.html
    * https://github.com/json-editor/json-editor
* Firebase
    * https://www.npmjs.com/package/firebase-tools
    * https://github.com/firebase/firebase-tools
    * https://firebase.google.com/docs/hosting/api-deploy#java
    * https://firebase.google.com/docs/cli
* Google OAUTH and OIDC
    * https://developers.google.com/identity/protocols/OAuth2
    * https://developers.google.com/identity/protocols/OpenIDConnect
    * https://github.com/googleapis/google-auth-library-nodejs#oauth2
* Google APIs
    * https://developers.google.com/identity/protocols/googlescopes#google_sign-in
    * https://developers.google.com/people/api/rest/v1/people/get
* Google Admin SDK
    * https://developers.google.com/admin-sdk/directory/v1/guides/manage-groups
    * https://developers.google.com/admin-sdk/directory/v1/reference/members/hasMember
    * https://developers.google.com/admin-sdk/groups-settings/v1/reference/
* Authorization via Google groups
    * https://stackoverflow.com/questions/16601699/determine-whether-user-is-group-member
    * https://developers.google.com/admin-sdk/directory/v1/guides/manage-groups#get_all_member_groups
