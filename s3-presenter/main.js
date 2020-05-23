$(document).ready(function () {

    /**
     * Get params from URL query string
     *  - cid [required] | Client ID in advertisement portal
     *  - platform [required] | Accept values: web | react-native
     *  - width [optional] | Width of advertisement presenter
     *  - height [optional] | Height of advertisement presenter
     *  - content [optional] | Input current page content for search the more related advertisements
     */
    const queryString = getAllParameters();
    var requestData = {};
    if (typeof queryString.cid !== 'undefined') {
        requestData.cid = queryString.cid;
    }
    if (typeof queryString.platform !== 'undefined') {
        requestData.platform = queryString.platform;
    } else {
        requestData.platform = 'web';
    }
    if (typeof queryString.width !== 'undefined') {
        requestData.width = queryString.width;
    }
    if (typeof queryString.height !== 'undefined') {
        requestData.height = queryString.height;
    }
    if (typeof queryString.content !== 'undefined') {
        requestData.content = queryString.content;
    }

    // Call API to get the advertisement data
    $.ajax({
        type: 'POST',
        url: 'https://1abw3c097g.execute-api.us-east-2.amazonaws.com/presenter',
        data: JSON.stringify(requestData),
        processData: false,
        contentType: 'application/json',
        success: function (ads) {
            ads = JSON.parse(ads);
            /**
             * Return list of advertisements
             *  - title | Title of advertisement
             *  - link | Landing URL of advertisement
             *  - type | Display type of advertisement | Possible values: image | html
             *  - url | (For type="image") Image URL
             *  - content | (For type="html") HTML code
             *  - width | Width of advertisement
             *  - height | Height of advertisement
             */

            // Prepare HTML code
            var html = '';
            for (var i in ads) {
                const ad = ads[i];

                var trackDisplayUrl = 'https://1abw3c097g.execute-api.us-east-2.amazonaws.com/track-display?fid=' + ad.fid;
                if (typeof queryString.cid !== 'undefined') {
                    trackDisplayUrl += '&cid=' + queryString.cid;
                }

                html += '<div data-aid="' + ad.aid + '" data-fid="' + ad.fid + '">';
                html += '<div class="like-container" id="like-container-fid-' + ad.fid + '">';
                html += '<a href="#" class="dislike-button" title="Dislike this Ads? Click here and let us know! We want to provide better user experience to you!">';
                html += '<svg viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" class="style-scope yt-icon" style="display: inline-block;"><g class="style-scope yt-icon"><path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v1.91l.01.01L1 14c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z" class="style-scope yt-icon"></path></g></svg>';
                html += '</a>';
                html += '<span class="disliked">Thank you for your feedback, we are sorry to bother you...</span>';
                html += '<span class="track-display"><img data-lazy="' + trackDisplayUrl + '" /></span>';
                html += '</div>';
                if (ad.type === 'image') {
                    const image = '<img data-lazy="' + ad.url + '" border="0" alt="' + ad.title + '" title="' + ad.title + '" />';
                    if (ad.link !== null && ad.link !== '') {
                        var landingUrl = 'https://1abw3c097g.execute-api.us-east-2.amazonaws.com/landing?aid=' + ad.aid + '&fid=' + ad.fid;
                        if (typeof queryString.cid !== 'undefined') {
                            landingUrl += '&cid=' + queryString.cid;
                        }
                        html += '<a href="' + landingUrl + '" target="_blank">' + image + '</a>';
                    } else {
                        html += image;
                    }
                } else if (ad.type === 'html') {
                    html += ad.content;
                }
                html += '</div>';
            }

            // Render HTML code to "canvas" DIV
            $('#canvas').html(html);
            $('#canvas').width(typeof queryString.width !== 'undefined' ? queryString.width : '100%');
            $('#canvas').height(typeof queryString.height !== 'undefined' ? queryString.height : '100%');

            // Register dislike button event listeners
            for (var i in ads) {
                const ad = ads[i];

                $('#like-container-fid-' + ad.fid + ' .dislike-button').click(function(event) {
                    event.preventDefault();

                    var trackDislikeUrl = 'https://1abw3c097g.execute-api.us-east-2.amazonaws.com/track-dislike?fid=' + ad.fid;
                    if (typeof queryString.cid !== 'undefined') {
                        trackDislikeUrl += '&cid=' + queryString.cid;
                    }

                    $.ajax({
                        method: 'GET',
                        url: trackDislikeUrl,
                        success: function() {
                            $('#like-container-fid-' + ad.fid + ' .disliked').show();
                        }
                    });
                });
            }

            // Slider
            $('#canvas').slick({
                lazyLoad: 'ondemand', // For "display" tracking
                autoplay: true,
                autoplaySpeed: 5000,
            });
        },
    });
});

function getAllParameters() {
    var vars = [], hash;
    var hashes = window.location.href.slice(window.location.href.indexOf('?') + 1).split('&');
    for (var i = 0; i < hashes.length; i++) {
        hash = hashes[i].split('=');
        vars.push(hash[0]);
        vars[hash[0]] = hash[1];
    }
    return vars;
}