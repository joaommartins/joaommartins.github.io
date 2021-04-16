import React from 'react';
import Sidebar from '../components/Sidebar';
import Layout from '../components/Layout';
import Page from '../components/Page';
import { useSiteMetadata } from '../hooks';

const NotFoundTemplate = () => {
  const { title, subtitle } = useSiteMetadata();

  return (
    <Layout title={`Page Not Found - ${title}`} description={subtitle}>
      <Sidebar />
      <Page title="404: PAGE NOT FOUND">
        <p>This route doesn&#39;t exist.</p>
      </Page>
    </Layout>
  );
};

export default NotFoundTemplate;
