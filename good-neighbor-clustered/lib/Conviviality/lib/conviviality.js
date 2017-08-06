var
    MannersModule = require('../../Manners'),
    SearchModule = require('../../Search'),
    Bitly = require('bitly'),
    Twitter = require('../../twitter'),
    OAuth = require('../../oauth'),
    ProsperityModule = require('../../Prosperity'),
    utf8 = require('utf8'),
    Manners, Prosperity, Search, path = require('path'),
    exec = require('child_process').exec,
    thisId


/**
 * Instantiate and return Conviviality
 * @class
 * @classdesc Module that handles all Twitter API interactions and Conversational activities
 *
 * @author Zack Proser
 */
class Conviviality {
    constructor() {
        this.init()
    }

    /**
     * Setup database connection
     * Register event listeners
     *
     * @param  {object} settings - Settings object derived from config.json
     * @param  {object} app.get('channel') - Main EventEmitter app.get('channel') shared by modules for PubSub
     */
    init() {

        //Instantiate submodules used by Conviviality

        this.Manners = new MannersModule()

        this.Prosperity = new ProsperityModule()

        this.Search = new SearchModule()

        /**
         * Instantiate Bitly
         * @type {Bitly}
         */
        this.bitly = new Bitly(app.get('settings').bitly.user, app.get('settings').bitly.key)

        /**
         * Instantiate Twitter REST client
         */
        this.instantiateTwitterREST()

        this.registerEventListeners()
    }

    registerEventListeners() {
        /**
         * Register Ambition-Driven Event Handlers
         */

        /**
         * Registers event listener for 'commandThankYouTweet' command sent by TimeManager
         * @param  {object} tweet - The tweet that TimeManager has authorized Conviviality to run thanking process on
         */
        app.get('channel').on('commandThankYouTweet', ((tweet) => {
            app.get('logger').info('Conviviality: commandThankYouTweet command received')
            this.thankYouTweet.apply(this, tweet)
        }))

        /**
         * Register event listener for 'commandRetweet' command sent by TimeManager
         */
        app.get('channel').on('commandRetweet', () => {
            this.retweet.call(this)
        })

        /**
         * Register event listener for 'commandFavorite' command sent by TimeManager
         */
        app.get('channel').on('commandFavorite', () => {
            this.favorite.call(this)
        })

        /**
         * Register event listener for 'commandFollow' command sent by TimeManager
         * @param  {object} tweet - The tweet that TimeManager has authorized Conviviality to run following process on
         */
        app.get('channel').on('commandFollow', () => {
            this.follow.call(this)
        })

        /**
         * Register event listener for 'commandContentRichTweet' command sent by TimeManager
         * Begins process of posting a content rich tweet based on a saved article
         */
        app.get('channel').on('commandContentRichTweet', () => {
            this.postContentRichTweet.call(this)
        })

        /**
         * Register event listener for 'commandAdvertisingTweet' command sent by TimeManager
         */
        app.get('channel').on('commandAdvertisingTweet', () => {
            this.postAdvertisingTweet.call(this)
        })

        /**
         * Register event listener for 'commandPrune' command sent by TimeManager
         */
        app.get('channel').on('commandPrune', () => {
            this.prune.call(this)
        })

        /**
         * Register event listener for 'commandCheckForRetweeters' command sent by TimeManager
         */
        app.get('channel').on('commandCheckForRetweeters', () => {
            this.determineRetweeters.call(this)
        })

        /**
         * Register event listener for 'commandYoureWelcomeTweet' command sent by TimeManager
         * @param  {object} tweet - The tweet that TimeManager has authorized Conviviality to run the welcoming process on
         */
        app.get('channel').on('commandYoureWelcomeTweet', ((tweet) => {
            app.get('logger').info('Conviviality: commandYoureWelcomeTweet received')
            this.youreWelcomeTweet.apply(this, tweet)
        }))

        /**
         * Register event listener for 'commandCheckForThankYouTweets' command sent by TimeManager
         */
        app.get('channel').on('commandCheckForThankYouTweets', () => {
            this.checkForThankYouTweets.call(this)
        })

        /**
         * Register event listener for 'commandUpdateWelcomedUsers' command sent by TimeManager
         * @param  {object} tweet - The tweet that TimeManager has authorized Coniviviality to run the updateWelcomedUsers process on
         */
        app.get('channel').on('commandUpdateWelcomedUsers', (tweet) => {
            app.get('logger').info('Conviviality: commandUpdateWelcomedUsers received')
            this.updateWelcomedUsers.apply(this, tweet)
        })
    }

    /**
     * Opens streaming connection to Twitter and saves a handle to the stream object in app namespace
     * Registers stream event listeners, attaching tweet approval functions to incoming tweets deemed appropriate
     */
    instantiateTwitterREST() {

        //Clean up previous connections
        if (app.get('twitter') != null) {

            app.get('logger').info('Found previous connection to Twitter...attempting clean up')

            delete app.get('twitter')

            app.set('twitter', undefined)

            app.get('logger').info('After clean up...')
        }

        var oauth = new OAuth.OAuth(
            'https://api.twitter.com/oauth/request_token',
            'https://api.twitter.com/oauth/access_token',
            app.get('settings').twitter.consumer_key,
            app.get('settings').twitter.consumer_secret,
            '1.0A',
            null,
            'HMAC-SHA1'
        )

        /**
         * Save handle to Twitter stream in app namespace
         */
        app.set('REST', oauth)
    }

    searchHighQualityTweetsByKeywords(callback) {
        if (!app.get('settings').twitter.target_hashtags.length) {
            app.get('logger').error("searchHighQualityTweetsByKeywords could not get target hashtags array from settings")
            return
        }
        var target = app.get('settings').twitter.target_hashtags.random()
        this.Search.query(target, ((err, results) => {
            if (err) callback(err)
            if (results && typeof results === "object") {
                callback(null, results)
            } else {
                callback(null, [])
            }
        }))
    }

    /**
     * Post an Amazon Associates item-based tweet with affiliate link
     *
     * Retrieves an untweeted Amazon item from the advertisement collection
     * Formats and posts tweet
     */
    postAdvertisingTweet() {
        app.get('logger').info('postAdvertisingTweet Running...')
        app.get('advertised_items').findOne({ tweeted: false }, (err, doc) => {

            if (err) {
                app.get('logger').error(err)
                return
            }

            if (null === doc) {
                app.get('logger').error('Conviviality:postAdvertisingTweet got null document.')
                return
            }

            if (typeof doc.title === "undefined" || doc.title === null || doc.title == '') {
                app.get('logger').error('Conviviality:postAdvertisingTweet read stored link with no title. Bailing.')
                return
            }

            /**
             * Start Building Tweet
             */
            app.get('logger').info('Building Advertising Tweet..')
            var tweet_text = String(doc.title)
                /**
                 * Get item title text up to the first dash
                 *
                 * (Titles often appear as: "Amazon Item Name - Some Description - More Text")
                 */
            var title_regex = /^[^-]+(?=-)/
            var matches = tweet_text.match(title_regex)
            if (matches && typeof matches[0] != "undefined") {
                tweet_text = matches[0]
            }
            thisId = doc._id

            tweet_text = this.condenseTweet(tweet_text)

            /**
             * Bitly-shorten advertising link
             */
            this.bitly.shorten(doc.link, ((shorten_error, bitly_response) => {
                if (shorten_error) {
                    app.get('logger').error('postAdvertisingTweet bitly error: ' + shorten_error)
                } else if (bitly_response && bitly_response.data && bitly_response.data.url !== "undefined") {
                    tweet_text = tweet_text + ' ' + bitly_response.data.url + ' ' + this.randomHashtag()
                }
            }))

            /**
             * Mark item as tweeted so it won't be repeated later
             */
            this.markAdvertised(thisId)

            /**
             * Post formatted tweet to Twitter
             */
            this.shortenTweet(tweet_text, doc.link)
        })
    }

    /**
     * Post a 'Thank You' tweet, thanking user who authored passed in tweet
     * @param  {object} tweet - The tweet containing the user to be thanked
     */
    thankYouTweet(tweet) {
        /**
         * Don't thank user again if they are the last user that was thanked
         */
        if (!tweet.user.name == this.Manners.lastThankedUser()) {
            app.get('logger').info('Posting Thank You Tweet At: ' + tweet.user.name)
            var thankYous = app.get('settings').thank_yous
            var tweet_body = thankYous.random()
            tweet_body += tweet.user.name
            tweet_body = this.condenseTweet(tweet_body)
            app.get('REST').post('https://api.twitter.com/1.1/statuses/update.json', {
                in_reply_to_status_id: tweet.id_str,
                status: tweet_body
            }, (err, reply) => {
                if (err) {
                    app.get('logger').error('Error posting thankYou tweet: ' + err)
                }
                if (reply) {
                    app.get('logger').info('Posted thankYou tweet: ' + reply)

                    this.Manners.updateLastThankedUser(tweet)
                }
            })

        } else {
            app.get('logger').warn(`Already thanked ${tweet.user.name} recently. Withholding Thank You tweet`)
        }
    }

    /**
     * Gather up usernames that have recently retweeted the bot
     *
     * Build a group 'Thank You' tweet that includes users who have not already been thanked
     * Append valid users to thank you tweet up to the character limit
     *
     * @param  {array} retweeters_to_thank - Array containing retweet objects which themselves contain users who should be thanked
     */
    thanksForRetweeting(retweeters_to_thank) {

        this.Manners.filterRetweetersToThank(retweeters_to_thank, ((err, valid_retweeters) => {
            if (err) app.get('logger').error(err)
            if (valid_retweeters.length < 1) {
                app.get('logger').info('thanksForRetweeting - No valid retweeters to thank right now.')
                return
            } else {
                app.get('logger').info('thanksForRetweeting thanking: ' + valid_retweeters)

                var status_text = app.get('settings').twitter.retweet_thank_yous.random() + ' '

                //Filter out duplicates
                valid_retweeters = valid_retweeters.unique()

                valid_retweeters.forEach((retweeter) => {
                    var retweeter = '@' + retweeter + ' '
                    if (status_text.length + retweeter.length < 140) {
                        status_text += retweeter
                    }
                })

                this.postPublicTweet(status_text)

                /**
                 * Update the last thanked user to avoid repetitive behavior
                 */
                this.Manners.updateLastThankedUsers(retweeters_to_thank)
            }
        }))
    }

    /**
     * Build a "You're Welcome" tweet and post it, referencing the user in the passed in tweet
     * @param  {object} tweet - The tweet containing the user who should receive a "You're Welcome " tweet
     */
    youreWelcomeTweet(tweet) {
        app.get('logger').info('Posting You\'re Welcome Tweet At: ' + tweet.user.name)
        var tweet_body = app.get('settings').twitter.youre_welcomes.random() + ' '
        tweet_body += '@' + tweet.user.screen_name
        tweet_body = this.condenseTweet(tweet_body)

        //Double check the user has not already been thanked by the time this youreWelcome command runs
        this.Manners.userHasBeenThanked(tweet.user.id_str, (err, thanked) => {

            if (err) {
                app.get('logger').error('youreWelcomeTweet: error ensuring user was not already thanked ' + err)
                return
            }

            if (true === thanked) {
                app.get('logger').info('youreWelcomeTweet: User ' + tweet.user.id_str + ' has already been thanked - Aborting')
                return
            }

            app.get('REST').post(
                'https://api.twitter.com/1.1/statuses/update.json',
                app.get('settings').twitter.access_token,
                app.get('settings').twitter.access_token_secret, { in_reply_to_status_id: tweet.id_str, status: tweet_body },
                'application/json',
                (e, data, status) => {
                    if (e) {
                        app.get('logger').error(e)
                        return
                    } else if (status && typeof status.headers.status != "undefined" && status.headers.status == '200 OK') {

                        app.get('logger').info('youreWelcomeTweet successfully posted: ' + tweet_body)

                        //You're welcome tweet was posted successfully - update welcomed users in db
                        app.get('channel').emit('commandUpdateWelcomedUsers', tweet)

                        this.Manners.addWelcomedUser(tweet, (err, done) => {
                            if (err) {
                                app.get('logger').error('youreWelcomeTweet: error saving welcomed tweet ID')
                            }
                            app.get('logger').info('youreWelcomeTweet: saved welcomed tweet')
                            return
                        })

                    } else {

                        app.get('logger').error('youreWelcomeTweet: error parsing REST response')
                    }
                }
            )
        })
    }

    /**
     * Retweet the passed in tweet
     * @param  {object} tweet - The tweet to be retweeted
     */
    retweet() {
        app.get('logger').info('Retweeting...')

        this.searchHighQualityTweetsByKeywords((err, tweets) => {
            if (err) app.get('logger').error(err)
            if (!tweets || typeof tweets === "undefined") {
                app.get('logger').warn('retweet could not retrieve any valid tweets from search')
                return
            }
            var tweet = tweets.random()
            if (typeof tweet === "undefined") {
                app.get('logger').error('retweet could not retrieve any tweets from search')
                return
            }
            if (tweet.user.name != this.Manners.getLastRetweetedUser()) {

                app.get('logger').info('Valid retweetUser found')

                var retweet_endpoint_url = 'https://api.twitter.com/1.1/statuses/retweet/'
                retweet_endpoint_url += tweet.id_str + '.json'

                app.get('REST').post(
                        retweet_endpoint_url,
                        app.get('settings').twitter.access_token,
                        app.get('settings').twitter.access_token_secret, { id: tweet.id_str },
                        'application/json',
                        (e, data, status) => {
                            if (e) app.get('logger').error(e)
                            app.get('logger').info('retweet: Successfully retweeted tweet id: ' + tweet.id_str + ' text: ' + tweet.text)
                        }
                    )
                    /**
                     * Update the last retweeted user to avoid repetitive behavior
                     */
                this.Manners.updateLastRetweetedUser(tweet)
            }
        })
    }

    /**
     * Favorite the passed in tweet
     * @param  {object} tweet - The tweet to be favorited
     */
    favorite() {
        this.searchHighQualityTweetsByKeywords((err, tweets) => {
            if (err) {
                app.get('logger').error(err)
                return
            }
            if (typeof tweets != "object" || typeof tweets === "undefined") {
                app.get('logger').error('Favorite was unable to retrieve tweets from search')
                return
            }
            var tweet = tweets.random()
            if (typeof tweet === "undefined") {
                app.get('logger').error('Favorite was unable to retrieve tweets from search')
                return
            }

            if (tweet.user.name != this.Manners.getLastFavoritedUser()) {

                app.get('REST').post(
                    'https://api.twitter.com/1.1/favorites/create.json',
                    app.get('settings').twitter.access_token,
                    app.get('settings').twitter.access_token_secret, { id: tweet.id_str },
                    'application/json',
                    (e, data, status) => {
                        if (e) app.get('logger').error(e)
                        if (typeof status.headers.status != "undefined") {
                            if (status.headers.status == '200 OK') {
                                app.get('logger').info('favorite: Successfully favorited tweet id: ' + tweet.id_str + ' text: ' + tweet.text)
                            } else {
                                app.get('logger').error('favorite: Error favoriting tweet: ' + tweet.text)
                            }
                        } else {
                            app.get('logger').error('favorite: Error favoriting tweet ' + tweet.text)
                        }
                    }
                )

                /**
                 * Keep track of which user was last favorited to avoid repetitive behavior
                 */
                this.Manners.updateLastFavoritedUser(tweet)
            }
        })
    }

    /**
     * Follow the user contained in the passed in tweet
     */
    follow() {
        this.searchHighQualityTweetsByKeywords((err, tweets) => {
            if (err) app.get('logger').error(err)
            app.get('logger').info('Favorite retrieved tweets from search')
            var tweet = tweets.random()
            if (typeof tweet === "undefined") {
                app.get('logger').error('Follow was unable to retrieve tweets from search')
                return
            }

            app.get('REST').post(
                'https://api.twitter.com/1.1/friendships/create.json',
                app.get('settings').twitter.access_token,
                app.get('settings').twitter.access_token_secret, { user_id: tweet.user.id_str },
                'application/json',
                (e, data, status) => {
                    if (e) app.get('logger').error(e)
                    if (typeof status.headers.status != "undefined") {
                        if (status.headers.status == '200 OK') {
                            app.get('logger').info('follow: Successfully followed user: ' + tweet.user.name)
                        } else {
                            app.get('logger').error('follow: Error following user: ' + tweet.user.name)
                        }
                    } else {
                        app.get('logger').error('follow: Error following user: ' + tweet.user.name)
                    }
                }
            )
        })
    }

    /**
     * Build and post a content rich tweet based off an article stored in the database
     */
    postContentRichTweet() {
        app.get('logger').info('Posting ContentRichTweet...')
        var
            thisId = null,
            tweet = null,
            title = null,
            link = null

        app.get('logger').info(`Manners Last Source:  ${this.Manners.getLastSource()} `)

        app.get('tweet_collection').findOne({ tweeted: false, origin: { $ne: this.Manners.getLastSource() } }, (err, doc) => {
            if (err) app.get('logger').error(err)

            if (!this.Manners.isAValidContentDoc(doc)) {
                app.get('logger').error('Scraper:storeTweet got tweet with invalid title, oriing or original_link. Bailing.')
                return
            } else {
                //We have a valid document - compose a tweet and update the last Manners-managed content source
                app.get('logger').info('Read out the following tweet from mongdodb:')
                thisId = doc._id
                this.markTweeted(thisId)
                this.Manners.updateLastSource(doc.origin)
                this.shortenTweet(doc.title, doc.original_link)
                return
            }
        })
    }

    /**
     * Post the passed in status text to Twitter as a public tweet
     * @param  {string} status_text - The content body of the tweet to be posted
     */
    postPublicTweet(status_text) {
        if (!status_text || 'undefined' == status_text) {
            app.get('logger').warn('No status text supplied to publicTweet')
            return
        } else {

            app.get('logger').info('postPublicTweet attempting to post: ' + status_text)

            app.get('REST').post(
                'https://api.twitter.com/1.1/statuses/update.json',
                app.get('settings').twitter.access_token,
                app.get('settings').twitter.access_token_secret, { status: status_text },
                'application/json',
                (e, data, status) => {
                    if (e) app.get('logger').error(e)
                    return
                }
            )
        }
    }

    handleDetermineRetweetersResponse(err, data, status) {
        if (err) {
            app.get('logger').error('handleDetermineRetweetersResponse: REST call error ' + err)
            return
        }
        if (status && status.headers.status && status.headers.status == '200 OK') {
            try {
                var tweet_array = JSON.parse(data)
                if (tweet_array.length > 0) {
                    var target_tweet = tweet_array[0]
                    if (typeof target_tweet.id_str != "undefined") {
                        var tweet_id = target_tweet.id_str
                        var retweeters_endpoint = 'https://api.twitter.com/1.1/statuses/retweets/' + tweet_id + '.json'
                        app.get('REST').get(
                            retweeters_endpoint,
                            app.get('settings').twitter.access_token,
                            app.get('settings').twitter.access_token_secret,
                            this.handleRetweetersResponse.call(this))
                    } else {
                        app.get('logger').error('handleDetermineRetweetersResponse got malformed tweet')
                    }
                } else {
                    app.get('logger').error('handleDetermineRetweetersResponse: no retweeters at this time.')
                }
            } catch (ex) {
                app.get('logger').error('handleDetermineRetweetersResponse: error parsing REST response ' + ex)
            }
        } else {
            app.get('logger').error('handleDetermineRetweetersResponse: error parsing REST response ')
            return
        }
    }

    handleRetweetersResponse(err, data, status) {
        if (err) {
            app.get('logger').error('handleRetweetersResponse: REST err ' + err)
            return
        }
        if (status && status.headers.status != "undefined" && status.headers.status == '200 OK') {
            try {
                var retweets_array = JSON.parse(data)
                if (retweets_array.length < 1) return
                var retweeters_to_thank = []
                retweets_array.forEach((retweet) => {
                    retweeters_to_thank.push(retweet.user.screen_name)
                })
                if (retweeters_to_thank.length > 0) {
                    this.thanksForRetweeting(retweeters_to_thank)
                }
            } catch (ex) {
                app.get('logger').error('handleRetweetersResponse: error parsing REST response ' + ex)
            }
        } else {
            app.get('logger').error('handleRetweetersResponse: error parsing REST response ')
        }
    }

    /**
     * Check for Twitter users that have recently retweeted one of the bot's tweet
     *
     * If valid not-yet-thanked retweeters are found, pass them to thanksForRetweeting method
     */
    determineRetweeters() {
        app.get('logger').info('Determining recent retweeters to thank')

        app.get('REST').get(
            'https://api.twitter.com/1.1/statuses/retweets_of_me.json',
            app.get('settings').twitter.access_token,
            app.get('settings').twitter.access_token_secret,
            this.handleDetermineRetweetersResponse.call(this)
        )
    }

    /**
     * Parses and handles response from calling mentions timeline. Examines mentions to determine if they are tweets thanking the avatar
     * @param  {Error} error   Error calling the mentions REST endpoint
     * @param  {Object} data   The response object coming back from Twitter REST API
     * @param  {Object} status REST status object
     */
    handleMentionsTimelineResponse(error, data, status) {
        if (error) {
            app.get('logger').error('checkForThankYouTweets: error calling mentions timeline endpoint: ' + error)
            return
        } else if (status && typeof status.headers.status != "undefined" && status.headers.status == '200 OK') {
            if (typeof data != "undefined" && data != '[]') {
                //We have valid data in the response
                try {
                    var mention_tweet_array = JSON.parse(data)
                    var thank_you_tweets = []
                    if (mention_tweet_array.length > 0) {
                        var thank_you_tweets = []

                        Manners.getWelcomedUsers((err, welcomed_tweet_id_array) => {
                            if (err) {
                                app.get('logger').error('handleMentionsTimelineResponse: error calling manners.getWelcomedUsers: ' + err)
                                return
                            }
                            mention_tweet_array.forEach((tweet) => {
                                if (typeof tweet.id_str == "undefined") return
                                if (Manners.isAThankYou(tweet) && welcomed_tweet_id_array.indexOf(tweet.id_str) === -1) {
                                    if (welcomed_tweet_id_array.indexOf(tweet.id_str) === -1) {
                                        thank_you_tweets.push(tweet)
                                        return
                                    } else {
                                        app.get('logger').info('Already welcomed user from tweet id: ' + tweet.id_str)
                                        return
                                    }
                                }
                            })
                            if (thank_you_tweets.length > 0) {
                                //We found some valid thank you tweets
                                app.get('logger').info('checkForThankYouTweets found thank_yous: ' + thank_you_tweets)
                                app.get('channel').emit('seekApprovalForYoureWelcomeTweets', thank_you_tweets)
                            } else {
                                app.get('logger').info('checkForThankYouTweets: no thank you tweets found at this time.')
                            }
                        })
                    } else {
                        app.get('logger').info('checkForThankYouTweets: no tweets mentioning avatar found at this time.')
                        return
                    }
                } catch (ex) {
                    app.get('logger').error('checkForThankYouTweets: error parsing mentions timeline response json: ' + ex)
                    return
                }
            } else {
                app.get('logger').error('checkForThankYouTweets: error parsing mentions timeline response: ' + error)
                return
            }
        } else {
            app.get('logger').error('checkForThankYouTweets: error parsing mentions timeline response: ' + error)
            return
        }
    }

    /**
     * Check if any recent tweets addressed directly to the bot are instances of a user thanking the bot
     * For a supportive action such as tweeting, following, retweeting or generally helping
     *
     * If valid 'Thank You' tweets addressed to bot are found, seek approval from TimeManager
     * To post a "You're Welcome" tweet in reply
     */
    checkForThankYouTweets() {
        app.get('REST').get(
            'https://api.twitter.com/1.1/statuses/mentions_timeline.json',
            app.get('settings').twitter.access_token,
            app.get('settings').twitter.access_token_secret,
            this.handleMentionsTimelineResponse.call(this)
        )
    }

    /**
     * Update the collection of users that have already received "You're Welcome" tweets
     * @param  {object} tweet - The tweet containing a user who received a "You're Welcome" tweet
     */
    updateWelcomedUsers(tweet) {
        Manners.addWelcomedUser(tweet)
    }

    /**
     * Convenience function to condense a tweet to a proper size
     * That will not exceed Twitter's character limit
     *
     * Anticipates a bitly shortlink will be added, leaving extra space
     * Based on average length of shortlinks
     *
     * @param  {string} tweet - The tweet content body to be shortened
     * @return {string} tweet - The condensed tweet content body
     */
    condenseTweet(tweet) {
        if (tweet.length > 100) {
            tweet = tweet.substring(0, 97)
            tweet += '...'
        }
        return tweet
    }

    /**
     * Adds dynamic hashtag to tweet text where appropriate
     *
     * Designed to increase appearance of organic behavior
     * And increase reach of bot's tweets into new app.get('channel')s
     * Not specified in settings, but usually still appropriate
     * To the realm of subject matter the bot is targeting
     *
     * @param  {string} tweet - The tweet content body to be 'hashtagified'
     * @return {string} tweet - The tweet content body with dynamic hashtag added
     */
    hashtagifyTweet(tweet) {
        //Get non article potential keywords of 6 letters or more
        var keywords = tweet.getKeywords()
        var target = keywords.random()
        if (typeof target != "undefined") {
            target = target.replace(/[^a-z0-9]/gmi, " ").replace(/\s+/g, " ")
            var hashtag = '#' + target
            return tweet.replace(target, hashtag)
        } else {

            return tweet
        }
    }

    /**
     * Convenience function that returns a random hashtag
     * From the bot's specified target hashtags
     * Maps to config.json's twitter.tracking_name field
     *
     * @return {string} hashtag - A randomly selected hashtag
     */
    randomHashtag() {
        return app.get('settings').twitter.target_hashtags.random()
    }

    /**
     * Takes intended tweet body content and a long url
     * Shortens the url with bitly and adds shortlink to content
     * Posts tweet body with shortlink to Twitter as a public tweet
     *
     * @param  {string} tweet - The intended tweet body content
     * @param  {string} link - The url to be Bitly-fied into a shortlink
     */
    shortenTweet(tweet, link) {
        var status_text = this.condenseTweet(tweet)
            /*
             * Choose a random keyword to add a hashtag to for greater reach:
             */
        status_text = this.hashtagifyTweet(status_text)
        app.get('logger').info('shortenTweet attempting bitly shorten: ')
        this.bitly.shorten(link, (shorten_error, bitly_response) => {
            if (shorten_error) {
                app.get('logger').error(shorten_error)
                return
            } else if (bitly_response && bitly_response.data && typeof bitly_response.data.url !== "undefined") {
                app.get('logger').info(`shortenTweet got back bitly: ${bitly_response.data.url}`)
                status_text = `${status_text}  ${bitly_response.data.url} #${this.randomHashtag()}`
                this.postPublicTweet(status_text)
                return
            } else {
                return
            }
        })
    }

    /**
     * Mark the the content record specified by the supplied id as 'tweeted' in Mongo
     * Prevents duplicate posting of a single item of content
     *
     * @param  {number} id - The native Mongo ID of the record to be marked as tweeted
     */
    markTweeted(id) {
        app.get('tweet_collection').update({ _id: id }, {
            $set: { 'tweeted': true },
        }, ((err, doc) => {
            if (err) app.get('logger').error(err)
            app.get('logger').info('Marked record: ' + id + ' as tweeted')
        }))
    }

    /**
     * Mark the advertisement item record specified by the supplied id as 'tweeted'
     *
     * @param  {number} id - The native Mongo ID of the record to be marked as tweeted
     */
    markAdvertised(id) {
        app.get('advertised_items').update({ _id: id }, {
            $set: { 'tweeted': true },
        }, (err, doc) => {
            if (err) app.get('logger').error(err)
            app.get('logger').info(`Marked advertisement record: ${id} as tweeted`)
        })
    }

    handleFollowersResponse(error, data, res) {

        if (error) {
            app.get('logger').error('Prune: error getting followers ids' + error)
            return
        }
        try {
            var followers_response = JSON.parse(data)
            var follower_ids = (typeof followers_response.ids === "undefined") ? null : followers_response.ids
        } catch (ex) {
            app.get('logger').error('Prune: error parsing REST followers response ' + ex)
            return
        }

        if (follower_ids && follower_ids.length) {
            //avatar has some followers, proceed with pruning
            this.getAvatarFriends((err, friends) => {
                if (err) {
                    app.get('logger').error('Prune: error getting avatar friends: ' + err)
                    return
                }
                if (friends && friends.length) {
                    var pruned = false
                    var target = friends.random()
                    if (follower_ids.indexOf(target) === -1) {
                        app.get('logger').info('attempting to prune non-following target: ' + target)
                            //Attempt to prune target
                        app.get('REST').post(
                            'https://api.twitter.com/1.1/friendships/destroy.json',
                            app.get('settings').twitter.access_token,
                            app.get('settings').twitter.access_token_secret, { id: target },
                            'application/json',
                            (prunePostErr, data, res) => {
                                if (prunePostErr) {
                                    app.get('logger').error('Prune post failed: ' + prunePostErr)
                                    return
                                } else {
                                    app.get('logger').info('Successfully pruned non-follower')
                                    return
                                }
                            }
                        )
                    } else {
                        app.get('logger').info('Prune: handleFollowersResponse did not get a non-follower, aborting for now')
                        return
                    }
                }
            })
        } else {
            app.get('logger').error('Prune: could not get follower ids, or avatar currently has no followers')
            return
        }
    }

    getAvatarFriends(callback) {
        app.get('REST').get(
            'https://api.twitter.com/1.1/friends/ids.json',
            app.get('settings').twitter.access_token,
            app.get('settings').twitter.access_token_secret,
            (err, data, res) => {
                if (err) {
                    callback(err)
                }
                if (typeof data == "string") {
                    try {
                        data = JSON.parse(data)
                    } catch (ex) {
                        callback(ex)
                    }
                    if (typeof data.ids != "undefined") {
                        //We got avatar's friends - hit up callback with them
                        callback(null, data.ids)
                    } else {
                        callback(new Error('No friends found for avatar'), null)
                    }
                } else {
                    callback(new Error('getAvatarFriends: could not parse friends REST response'))
                }
            })
    }

    /**
     * Gathers up all bot followers and all Twitter accounts that bot is following
     * Selects one account that bot is following who is not following bot back
     * Destroys the friendship (unfollows) this user
     *
     * Designed to assist in maintaining positive 'social proof':
     * The bot is being followed by more people than it is following
     *
     * Over time, keeps the bot's follower to following ratio looking healthy
     */
    prune() {
        app.get('logger').info('Attempting to prune non-followers...')

        app.get('REST').get(
            "https://api.twitter.com/1.1/followers/ids.json",
            app.get('settings').twitter.access_token,
            app.get('settings').twitter.access_token_secret,
            this.handleFollowersResponse.call(this)
        )
    }
}
module.exports = Conviviality