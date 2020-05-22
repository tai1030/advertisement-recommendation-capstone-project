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
            var html = '';
            for (var i in ads) {
                const ad = ads[i];
                html += '<div data-aid="' + ad.aid + '" data-fid="' + ad.fid + '">';
                if (ad.type === 'image') {
                    const image = '<img src="' + ad.url + '" border="0" alt="' + ad.title + '" title="' + ad.title + '" />';
                    if (ad.link !== null && ad.link !== '') {
                        html += '<a href="' + ad.link + '" target="_blank">' + image + '</a>';
                    } else {
                        html += image;
                    }
                } else if (ad.type === 'html') {
                    html += ad.content;
                }
                html += '</div>';
            }
            $('#canvas').html(html);
            $('#canvas').width(typeof queryString.width !== 'undefined' ? queryString.width : '100%');
            $('#canvas').height(typeof queryString.height !== 'undefined' ? queryString.height : '100%');
            $('#canvas').slick({
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