const fs = require('fs');
const path = require('path');

const siteDir = path.join(__dirname, '..', 'site');
const raw = fs.readFileSync(path.join(siteDir, 'data.js'), 'utf8');
const data = new Function(raw + '; return RAW;')();

const commentsMap = {};
const coreVideos = data.videos.map(video => {
  const { comments, ...rest } = video;
  if (comments && comments.length > 0) commentsMap[video.bvid] = comments;
  return rest;
});

const packed = {};
for (const [bvid, comments] of Object.entries(commentsMap)) {
  packed[bvid] = comments.map(comment => [
    comment.name ?? '',
    comment.like ?? 0,
    comment.ctime ?? 0,
    comment.message ?? '',
    (comment.replies || []).map(reply => [reply.name ?? '', reply.like ?? 0, reply.message ?? ''])
  ]);
}

const core = { ...data, videos: coreVideos };
fs.writeFileSync(path.join(siteDir, 'data.js'), 'const RAW = ' + JSON.stringify(core) + ';\n', 'utf8');
fs.writeFileSync(
  path.join(siteDir, 'data-comments.js'),
  `const RAW_PACKED_COMMENTS = ${JSON.stringify(packed)};\n` +
  `const RAW_COMMENTS = (() => { const unpacked = {}; for (const [bvid, comments] of Object.entries(RAW_PACKED_COMMENTS)) { unpacked[bvid] = comments.map(([name, like, ctime, message, replies]) => ({ name, like, ctime, message, replies: replies.map(([name, like, message]) => ({ name, like, message })) })); } return unpacked; })();\n`,
  'utf8'
);

const totalComments = Object.values(commentsMap).reduce((sum, list) => sum + list.length, 0);
console.log(`data.js: ${(fs.statSync(path.join(siteDir, 'data.js')).size / 1024).toFixed(1)} KB`);
console.log(`data-comments.js: ${(fs.statSync(path.join(siteDir, 'data-comments.js')).size / 1024).toFixed(1)} KB`);
console.log(`Videos with comments: ${Object.keys(commentsMap).length}; comments: ${totalComments}`);
