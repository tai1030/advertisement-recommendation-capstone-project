const AWS = require("aws-sdk");
const s3 = new AWS.S3();
const rekognition = new AWS.Rekognition();
const DynamoDB = require("aws-sdk/clients/dynamodb");
const got = require('got');
const request = require('request-promise');
const fileType = require('file-type');

// Rekognition detect text min. confidence
var minConfidenceText = 60;

// Rekognition detect label min. confidence
var minConfidenceLabel = 60;

// S3 bucket name
var bucketName = "advertisement-files";

// Load DynamoDB client
const dynamodb = new DynamoDB.DocumentClient({
    region: 'us-east-2'
});

exports.handler = async (event, context) => {
    for (const record of event.Records) {
        if (record.eventName !== 'INSERT') {
            continue;
        }

        // Get DynamoDB inserted record object
        var data = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.NewImage);
        console.log('DynamoDB trigger: Table "file" inserted record: ', JSON.stringify(data, null, 2));

        // Image URL(s) for single file
        var imageUrls = [];

        // For "html", scan HTML code to get all image URLs
        switch (data.type) {
            case 'image':
                imageUrls.push(data.url);
                break;
            case 'html':
                imageUrls = imageUrls.concat(getImageUrlsFromHtmlCode(data.content.replace(/\\/g, '')));
                break;
        }

        console.log('imageUrls: ', JSON.stringify(imageUrls, null, 2));

        // Download file from URL, and upload to S3 bucket
        var labels = {};
        for (var i in imageUrls) {
            const uploadResult = await uploadFileFromUrl(imageUrls[i], data.aid + '/' + data.fid);

            if (uploadResult === false) {
                console.error('Failed to download [' + imageUrls[i] + '], or not supported file format.');
                continue;
            }

            if (typeof uploadResult.key === 'undefined' || uploadResult.key === null || uploadResult.key === '') {
                console.error('Failed to upload [' + imageUrls[i] + '] to S3. (No key response) | Response: ' + JSON.stringify(uploadResult));
                continue;
            }

            // Detect labels and text on image by AWS Rekognition
            var imageLabels = await detectImage(uploadResult.key);
        }

        // Merge object across images
        for (var i in imageLabels) {
            if (i in labels) {
                labels[i] = Math.max(imageLabels[i], labels[i]);
            } else {
                labels[i] = imageLabels[i];
            }
        }

        // Get related words of each label
        var batchApiActions = [];
        const names = [];
        for (var name in labels) {
            names.push(name);
            batchApiActions.push(getRelatedWords(name));
        }
        const batchApiResults = await Promise.all(batchApiActions);
        for (var i in batchApiResults) {
            for (var relatedWord in batchApiResults[i]) {
                // Confidence rate of label (AWS Rekognition) * Confidence rate of related word from API (e.g. 0.8 * 0.9 = 0.72)
                const rate = labels[names[i]] * batchApiResults[i][relatedWord];

                // Min. confidence rate
                // if (rate <= 0.6) {
                //    continue;
                // }

                // Merge into labels object (by related words)
                if (relatedWord in labels) {
                    labels[relatedWord] = Math.max(rate, labels[relatedWord]);
                } else {
                    labels[relatedWord] = rate;
                }
            }
        }

        // Create label records into DynamoDB
        var dynamoDbActions = [];
        for (var label in labels) {
            console.info('Put label: ' + JSON.stringify({
                fid: data.fid,
                label,
                rate: labels[label]
            }));
            dynamoDbActions.push(addLabel(data.fid, label, labels[label]));
        }

        // (Await) Wait all DynamoDB actions finished
        await Promise.all(dynamoDbActions);
    }
};

async function uploadFileFromUrl(sourceUrl, targetPath) {
    // Download file from URL (and get file MIME)
    const [fileMime, response] = await Promise.all([
        fileType.fromStream(got.stream(sourceUrl)),
        request({
            uri: sourceUrl,
            encoding: null
        })
    ]);

    // Failed to download file, or file format not supported
    if (fileMime === null || response === null) {
        return false;
    }

    // Upload downloaded file to S3 bucket
    return await s3
        .upload({
            Bucket: bucketName,
            Key: targetPath + '.' + fileMime.ext,
            Body: response,
            ContentType: fileMime.mime,
            ACL: 'public-read'
        })
        .promise();
}

function getImageUrlsFromHtmlCode(html) {
    if (typeof html !== 'string') {
        return [];
    }

    var imageUrls = html.match(/(https?:\/\/[a-z\-_0-9\/\:\.]*\.(jpg|png))/ig);
    return Array.isArray(imageUrls) ? [...new Set(imageUrls)] : []; // Array unique
}

async function detectImage(s3ObjectKey) {
    // Detect labels and text on image by AWS Rekognition
    const [texts, labels] = await Promise.all([
        rekognition.detectText({
            Image: {
                S3Object: {
                    Bucket: bucketName,
                    Name: s3ObjectKey
                }
            },
            Filters: {
                WordFilter: {
                    MinConfidence: minConfidenceText
                }
            }
        }).promise(),
        rekognition.detectLabels({
            Image: {
                S3Object: {
                    Bucket: bucketName,
                    Name: s3ObjectKey
                }
            },
            MinConfidence: minConfidenceLabel
        }).promise()
    ]);

    // Build result object (by text)
    var result = {};
    for (var i in texts['TextDetections']) {
        var text = texts['TextDetections'][i];
        if (text['Type'] !== 'WORD') {
            continue;
        }

        // To lower case
        text['DetectedText'] = text['DetectedText'].toLowerCase();
        if (shouldIgnoreLabel(text['DetectedText'])) {
            continue;
        }

        if (text['DetectedText'] in result) {
            result[text['DetectedText']] = Math.max(text['Confidence'], result[text['DetectedText']]);
        } else {
            result[text['DetectedText']] = text['Confidence'];
        }
    }

    // Build result object (by labels)
    for (var i in labels['Labels']) {
        var label = labels['Labels'][i];

        // To lower case
        label['Name'] = label['Name'].toLowerCase();
        if (shouldIgnoreLabel(label['Name'])) {
            continue;
        }

        if (label['Name'] in result) {
            result[label['Name']] = Math.max(label['Confidence'], result[label['Name']]);
        } else {
            result[label['Name']] = label['Confidence'];
        }
    }

    return result;
}

async function getRelatedWords(word) {
    word = word.toLowerCase();

    // Get from DynamoDB if the word existing
    var relatedWords = await getDbRelatedWords(word);
    if (!Array.isArray(relatedWords) || relatedWords.length === 0) {
        // Call API to get the related words
        var apiResponse = null;
        try {
            apiResponse = await request({
                method: 'GET',
                url: 'https://twinword-word-associations-v1.p.rapidapi.com/associations/',
                qs: { entry: word },
                headers: {
                    'x-rapidapi-host': 'twinword-word-associations-v1.p.rapidapi.com',
                    'x-rapidapi-key': '73a5e4ece1mshb91defd88859d60p161349jsn646122d27639',
                    useQueryString: true
                },
                timeout: 5000
            });
        } catch (e) {
            console.warn('Failed to call related words API [' + word + '] | Exception: ' + e);
            return {};
        }

        if (apiResponse === null) {
            console.warn('Failed to call related words API [' + word + '] | Result: null');
            return {};
        } else if (typeof apiResponse['result_code'] !== 'undefined') {
            if (apiResponse['result_code'] == '200') { // Success
                if (typeof apiResponse['associations_scored'] === 'undefined') {
                    console.warn('Failed to call related words API [' + word + '] | (200 but missing "associations_scored") | Result: ' + apiResponse);
                    return {};
                } else {
                    console.info('Successful to call related words API [' + word + '] | Result: ' + apiResponse);
                    relatedWords = apiResponse['associations_scored'];
                }
            } else if (apiResponse['result_code'] == '462') { // Entry word not found
                console.info('Successful to call related words API [' + word + '] | (No matched result) | Result: ' + apiResponse);
                relatedWords = {'-': 0};
            } else {
                console.warn('Failed to call related words API [' + word + '] | (Unexpected status code) | Result: ' + apiResponse);
                return {};
            }
        }

        // (Async) Batch DynamoDB write actions (promise)
        var dynamoDbActions = [];

        // Write related words to DynamoDB from API result (reduce call API $$$$)
        for (var relatedWord in relatedWords) {
            dynamoDbActions.push(addRelatedWord(word, relatedWord.toLowerCase(), relatedWords[relatedWord]));
        }

        // (Await) Wait all DynamoDB actions finished
        await Promise.all(dynamoDbActions);
    }

    return relatedWords;
}

async function getDbRelatedWords(word) {
    var result = await dynamodb.query({
        TableName: 'related_word',
        IndexName: 'word-rate-index',
        KeyConditionExpression: '#word = :word',
        ExpressionAttributeNames: {
            '#word': 'word'
        },
        ExpressionAttributeValues: {
            ':word': word
        }
    }).promise();

    const items = typeof result.Items !== 'undefined' && result.Items !== null ? result.Items : [];
    var results = {};
    for (var i in items) {
        results[items[i].related] = items[i].rate;
    }

    return results;
}

async function addRelatedWord(word, related, rate) {
    return await dynamodb.put({
        TableName: 'related_word',
        Item: {
            'word': word,
            'related': related,
            'rate': rate
        },
    }).promise();
}

async function addLabel(fid, label, rate) {
    return await dynamodb.put({
        TableName: 'label',
        Item: {
            'fid': fid,
            'label': label,
            'rate': rate
        },
    }).promise();
}

function shouldIgnoreLabel(label) {
    const blacklist = ['alphabet', 'ampersand', 'any', 'click', 'demo', 'image', 'its', 'label', 'larger', 'logo', 'number', 'object', 'on', 'symbol', 'text', 'to', 'trademark', 'triangle', 'version', 'view', 'word'];
    return blacklist.includes(label);
}