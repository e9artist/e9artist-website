// .eleventy.js
module.exports = async function(eleventyConfig) {
    // Dynamically import the RSS plugin
    const pluginRss = await import('@11ty/eleventy-plugin-rss');
    
    // Add the RSS plugin
    eleventyConfig.addPlugin(pluginRss.default);

    // Copy static assets to output
    eleventyConfig.addPassthroughCopy("src/css");
    eleventyConfig.addPassthroughCopy("src/audio"); 
    eleventyConfig.addPassthroughCopy("src/music");
    eleventyConfig.addPassthroughCopy("src/images");
    eleventyConfig.addPassthroughCopy("src/downloads"); 
    
    // Collection for blog posts
    eleventyConfig.addCollection("blog", function(collection) {
        return collection.getFilteredByTag("blog").reverse();
    });
    
    // Custom filters
    eleventyConfig.addFilter("readableDate", function(date) {
        return new Date(date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    });
    
    eleventyConfig.addFilter("isoDate", function(date) {
        return new Date(date).toISOString().split('T')[0];
    });
    
    eleventyConfig.addFilter("limit", function(array, limit) {
        return array.slice(0, limit);
    });
    
    // ✅ Load songs and downloads data
    const songs = require("./src/_data/songs.js");
    const downloads = require("./src/_data/downloads.js");
    
    // ✅ Log to debug (remove after testing)
    console.log("Songs loaded:", songs ? songs.length : 0);
    console.log("Downloads loaded:", downloads ? downloads.length : 0);
    
    // ✅ UPDATED: Collection that includes blog posts, songs, and downloads
    eleventyConfig.addCollection("allUpdates", function(collection) {
        const updates = [];
        
        // Add blog posts
        const blogPosts = collection.getFilteredByTag("blog").map(post => ({
            title: post.data.title || "Untitled",
            description: post.data.description || "",
            date: post.date,
            url: post.url,
            type: "blog",
            author: post.data.author || "E9",
            tags: post.data.tags || []
        }));
        updates.push(...blogPosts);
        
        // Add songs from data file
        if (songs && Array.isArray(songs)) {
            songs.forEach(song => {
                if (song.date) {
                    updates.push({
                        title: "🎵 " + song.title,
                        description: song.description || "New song available!",
                        date: new Date(song.date),
                        url: "/music/",
                        type: "song",
                        author: "E9",
                        duration: song.duration,
                        album: song.album
                    });
                }
            });
        }
        
        // Add downloads from data file
        if (downloads && Array.isArray(downloads)) {
            downloads.forEach(download => {
                // Make sure the download has a date
                if (download.date) {
                    updates.push({
                        title: "📥 " + download.title,
                        description: download.description || "New download available!",
                        date: new Date(download.date),
                        url: "/downloads/",
                        type: "download",
                        author: "E9",
                        fileType: download.type || "file"
                    });
                } else {
                    // If no date, log a warning
                    console.warn("Download missing date:", download.title);
                }
            });
        }
        
        // Sort by date, newest first
        return updates.sort((a, b) => b.date - a.date);
    });

    return {
        dir: {
            input: "src",
            output: "public"
        }
    };
};