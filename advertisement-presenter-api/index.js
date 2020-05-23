const DynamoDB = require("aws-sdk/clients/dynamodb");

// Load DynamoDB client
const dynamodb = new DynamoDB.DocumentClient({
    region: 'us-east-2'
});

// Label min. confidence
var minConfidenceLabel = 70;

exports.handler = async (event, context, callback) => {
    /*
        Example request JSON format
        {
            "cid": "C-1000001",
            "platform": "web",
            "width": 272,
            "height": 92,
            "content": "Raw dog food diets are controversial. But the popularity of the diets -- which emphasize raw meat, bones, fruits, and vegetables -- is rising.  Racing greyhounds and sled dogs have long eaten raw food diets. Extending those feeding practices to the family pet is a more recent idea, proposed in 1993 by Australian veterinarian Ian Billinghurst. He called his feeding suggestions the BARF diet, an acronym that stands for Bones and Raw Food, or Biologically Appropriate Raw Food.  Billinghurst suggested that adult dogs would thrive on an evolutionary diet based on what canines ate before they became domesticated: Raw, meaty bones and vegetable scraps. Grain-based commercial pet foods, he contended, were harmful to a dog’s health.  Many mainstream veterinarians disagree, as does the FDA. The risks of raw diets have been documented in several studies published in veterinary journals.",
        }
    */
    const requestBody = JSON.parse(event.body);
    console.log('>> Request: ' + JSON.stringify(requestBody, null, 2));

    // Check request body format
    if (!validateRequestBody(requestBody)) {
        return sendResponse({
            "status": false,
            "message": "Invalid request"
        });
    }

    // Get keywords from input content
    var keywords = [];
    if (typeof requestBody.content !== 'undefined' && requestBody.content !== null && requestBody.content !== '') {
        keywords = parseContent(requestBody.content);
    }

    // Get "cid"
    const cid = typeof requestBody.cid !== 'undefined' && requestBody.cid !== null && requestBody.cid !== '' ? cid : null;

    // Get ads by label
    var ads = [];
    if (keywords.length > 0) {
        // Get file+info filtered by label
        ads = await getAdsListByLabels(keywords, cid);
    } else {
        // Get all file+info
        ads = await getAdsList(cid);
    }
    
    // API response
    console.log('<< Response: ' + JSON.stringify(ads, null, 2));
    return sendResponse(ads);

    function sendResponse(jsonObject) {
        callback(null, {
            isBase64Encoded: false,
            statusCode: 200,
            body: JSON.stringify(jsonObject),
            headers: {
                "Access-Control-Allow-Origin": "*"
            }
        });
        return;
    }
};

function validateRequestBody(requestBody) {
    if (typeof requestBody === 'undefined') {
        console.warn('API request validatation failed | Check: requestBody=undefined');
        return false;
    }

    // Check rules for base object
    const rules = [
        typeof requestBody.platform === 'string' && ['web', 'react-native'].includes(requestBody.platform),
    ];
    if (!rules.every(Boolean)) {
        console.warn('API request validatation failed | Check: ' + JSON.stringify(rules));
        return false;
    }

    return true;
}

function parseContent(content) {
    const ignoreList = [
        '', 'is', 'are', 'am', 'i', 'he', 'she', 'it', 'we', 'them', 'they', 'him', 'his', 'her', 'us', 'and', 'or', 'but', 'the', 'of', 'which', 'by', 'a', 'an', 'what', 'why', 'which', 'when', 'how', 'to', 'about', 'yes', 'no', 'not', 'yes', 'yet', 'have', 'has', 'had', 'be', 'been', 'as', 'too', 'many', 'much', 'before', 'after', 'by', 'more', 'less', 'the', 'that', 'alphabet', 'ampersand', 'any', 'click', 'demo', 'image', 'its', 'label', 'larger', 'logo', 'number', 'object', 'on', 'symbol', 'text', 'to', 'trademark', 'triangle', 'version', 'view', 'word'
    ];
    var resultKeywords = [];
    const keywords = content.replace(/[^a-zA-Z ]/g, "").toLowerCase().split(' ');
    for (var i in keywords) {
        if (ignoreList.includes(keywords[i]) || resultKeywords.includes(keywords[i])) {
            continue;
        }
        resultKeywords.push(keywords[i]);
    }
    return resultKeywords;
}

async function getAdsList(cid) {
    return await getAdsListByLabels([], cid);
}

async function getAdsListByLabels(keywords, cid) {
    var fids = [];
    var batchQueryActions = [];

    // Batch query "label" table if provided "keywords"
    if (Array.isArray(keywords) && keywords.length > 0) {
        batchQueryActions = [];
        for (var i in keywords) {
            batchQueryActions.push(searchLabel(keywords[i], minConfidenceLabel));
        }
        const batchQueryResults = await Promise.all(batchQueryActions);
        for (var i in batchQueryResults) {
            const result = batchQueryResults[i];
            const items = typeof result.Items !== 'undefined' && result.Items !== null ? result.Items : [];
            var results = {};
            for (var i in items) {
                // Check tracking stats by "fid"
                const {clickRate, dislikeRate} = await getClickDislikeRate(items[i].fid, cid);

                // Hide Ads if dislike-rate >= 20%
                if (dislikeRate >= 0.2) {
                    continue;
                }

                // Adjust Ads rate (score) by click-rate and dislike-rate
                items[i].rate = getAdjustedRate(items[i].rate, clickRate, dislikeRate);

                // Push label object to "results" array
                if (items[i].fid in results) {
                    // If existing, just put if the rate is higher
                    if (items[i].rate > results[items[i].fid]) {
                        results[items[i].fid] = items[i].rate;
                    }
                } else {
                    results[items[i].fid] = items[i].rate;
                }
            }

            // Sort by rate DESC
            var sortable = [];
            for (var label in results) {
                sortable.push([label, results[label]]);
            }
            sortable.sort(function(a, b) {
                return b[1] - a[1];
            });
            for (var i in sortable) {
                fids.push(sortable[i]);
            }
        }
    }
    console.debug('fids=' + JSON.stringify(fids, null, 2));

    // Get files
    var files = [];
    if (fids.length > 0) {
        // List file by "fid"
        batchQueryActions = [];
        for (var i in fids) {
            batchQueryActions.push(getFile(fids[i][0])); // [0]=fid, [1]=rate
        }
        const batchQueryResults = await Promise.all(batchQueryActions);
        for (var i in batchQueryResults) {
            const result = batchQueryResults[i];
            const items = typeof result.Items !== 'undefined' && result.Items !== null ? result.Items : [];
            /**
             * Object: fid, aid, type, url, content, width, height
             */
            if (items.length > 0) {
                files.push(items[0]);
            }
        }
    } else {
        // List file
        const result = await dynamodb.scan({
            TableName: 'file'
        }).promise();
        files = result.Items !== undefined ? result.Items : [];

        // Adjust Ads display sequence by click-rate and dislike-rate
        var removeFileIndexs = [];
        for (var i in files) {
            // Check tracking stats by "fid"
            const {clickRate, dislikeRate} = await getClickDislikeRate(files[i].fid, cid);

            // Hide Ads if dislike-rate >= 20%
            if (dislikeRate >= 0.2) {
                removeFileIndexs.push(i);
            }

            // Get Ads rate (score) by click-rate and dislike-rate
            files[i].rate = getAdjustedRate(0, clickRate, dislikeRate);
        }

        // Remove Ads which is dislike-rate >= 20% from "files" array
        files.splice(removeFileIndexs, 1);

        // Sort by rate DESC
        files.sort(function(a, b) {
            return b.rate - a.rate;
        });
    }
    console.debug('files=' + JSON.stringify(files, null, 2));
    

    // Get aids by files
    const aids = [];
    for (var i in files) {
        if (typeof files[i].aid !== 'undefined' && files[i].aid !== null && files[i].aid !== '') {
            aids.push(files[i].aid);
        }
    }

    // Get info, merge into "files"
    batchQueryActions = [];
    var batchQueryActionsIndex = [];
    for (var i in aids) {
        batchQueryActionsIndex.push(aids[i]);
        batchQueryActions.push(getInfo(aids[i]));
    }
    const batchQueryResults = await Promise.all(batchQueryActions);
    var infos = {};
    for (var i in batchQueryResults) {
        const result = batchQueryResults[i];
        const items = typeof result.Items !== 'undefined' && result.Items !== null ? result.Items : [];
        if (items.length > 0) {
            infos[aids[i]] = items[0];
        }
    }
    for (var i in files) {
        if (files[i].aid in infos) {
            const info = infos[files[i].aid];
            files[i].title = info.title;
            files[i].link = info.link;
        }
    }
    console.debug('files=' + JSON.stringify(files, null, 2));

    return files;
}

async function searchLabel(label, minConfidenceLabel) {
    return await dynamodb.query({
        TableName: 'label',
        IndexName: 'label-rate-index',
        KeyConditionExpression: '#label = :label AND #rate > :rate',
        ExpressionAttributeNames: {
            '#label': 'label',
            '#rate': 'rate'
        },
        ExpressionAttributeValues: {
            ':label': label,
            ':rate': minConfidenceLabel,
        }
    }).promise();
}

async function getFile(fid) {
    return await dynamodb.query({
        TableName: 'file',
        KeyConditionExpression: '#fid = :fid',
        ExpressionAttributeNames: {
            '#fid': 'fid'
        },
        ExpressionAttributeValues: {
            ':fid': fid
        }
    }).promise();
}

async function getInfo(aid) {
    return await dynamodb.query({
        TableName: 'info',
        KeyConditionExpression: '#aid = :aid',
        ExpressionAttributeNames: {
            '#aid': 'aid'
        },
        ExpressionAttributeValues: {
            ':aid': aid
        }
    }).promise();
}

async function getTrack(fid, cid) {
    const result = await dynamodb.query({
        TableName: 'tracking',
        KeyConditionExpression: '#fid = :fid AND #cid = :cid',
        ExpressionAttributeNames: {
            '#fid': 'fid',
            '#cid': 'cid'
        },
        ExpressionAttributeValues: {
            ':fid': fid,
            ':cid': cid
        }
    }).promise();
    const items = typeof result.Items !== 'undefined' && result.Items !== null ? result.Items : [];

    var track = (items.length > 0) ? items[0] : {
        fid,
        cid,
        display: 0,
        click: 0,
        dislike: 0
    };

    track.display = typeof track.display === 'undefined' ? 0 : track.display;
    track.click = typeof track.click === 'undefined' ? 0 : track.click;
    track.dislike = typeof track.dislike === 'undefined' ? 0 : track.dislike;

    return track;
}

async function getClickDislikeRate(fid, cid) {
    cid = cid === null ? "GUEST" : cid;
    const track = await getTrack(fid, cid);

    // Calculate click-rate and dislike-rate
    var clickRate = 0;
    var dislikeRate = 0;
    if (track.display > 0) {
        clickRate = track.click / track.display;
        dislikeRate = track.dislike / track.display;
    }

    return {clickRate, dislikeRate};
}

/**
 * Adjust Ads rate (score) by click-rate and dislike-rate
 * For example...
 * Base rate is 75% (From confidence% of AWS Rekognition and Related words API)
 * Display=1,000,000
 * Click=100,000 (Click-rate = 10000/1000000 = 1%)
 * Dislike=300,000 (Click-rate = 30000/1000000 = 3%)
 * Final rate is = 75% + (1% * 10) - (3% * 10)
 *               = 75% + 10% - 30%
 *               = 55%
 */
function getAdjustedRate(baseRate, clickRate, dislikeRate) {
    baseRate += clickRate * 10;
    baseRate -= dislikeRate * 10;

    return baseRate;
}